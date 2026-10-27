import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }));

const etat = vi.hoisted(() => ({
  rpc: vi.fn(),
  tables: new Map<string, { delete: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> }>(),
  updateUserById: vi.fn(async () => ({ error: null })),
  motsDePasseAcceptes: new Set<string>(),
  journaliser: vi.fn(async () => undefined),
  legacy: { failed_count: 0, locked_until: null as string | null } as { failed_count: number; locked_until: string | null } | null,
}));

function table(nom: string) {
  if (!etat.tables.has(nom)) {
    const chaine: Record<string, unknown> = {};
    chaine.eq = vi.fn(async () => ({ error: null }));
    etat.tables.set(nom, {
      delete: vi.fn(() => chaine as { eq: () => Promise<unknown> }),
      insert: vi.fn(async () => ({ error: null })),
      upsert: vi.fn(async () => ({ error: null })),
      select: vi.fn(() => ({ eq: () => ({ maybeSingle: async () => ({ data: etat.legacy }) }) })),
    } as never);
  }
  return etat.tables.get(nom)!;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: etat.rpc, from: (n: string) => table(n), auth: { admin: { updateUserById: etat.updateUserById } } }),
}));
vi.mock("@/lib/audit/journal", () => ({ journaliser: etat.journaliser }));
const connexion = () => ({
  auth: {
    signInWithPassword: vi.fn(async ({ password }: { password: string }) => ({ error: etat.motsDePasseAcceptes.has(password) ? null : new Error("refus") })),
    signOut: vi.fn(async () => ({})),
  },
});
vi.mock("@supabase/supabase-js", () => ({ createClient: () => connexion() }));

import { ESSAIS_MAX_COMPTE, ESSAIS_MAX_IP, motDePassePin, verifierPin } from "@/lib/auth/pin-securise";

const USER = { id: "u1", email: "c@exemple.fr", organization_id: "org1", full_name: "Chauffeur Test" };
const reservation = (p: Partial<{ autorise: boolean; portee: string; restants: number; verrou_jusqua: string | null; vient_de_verrouiller: boolean }> = {}) => ({
  data: [{ autorise: true, portee: "ip", restants: 4, verrou_jusqua: null, vient_de_verrouiller: false, ...p }],
  error: null,
});

beforeEach(() => {
  process.env.PIN_PEPPER = "poivre-de-test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemple.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "x";
  etat.rpc.mockReset();
  etat.tables.clear();
  etat.updateUserById.mockClear();
  etat.journaliser.mockClear();
  etat.motsDePasseAcceptes = new Set();
  etat.legacy = { failed_count: 0, locked_until: null };
});

describe("verrou PIN atomique, par adresse IP", () => {
  it("réserve l'essai avant de vérifier, avec l'IP hachée (jamais en clair)", async () => {
    etat.rpc.mockResolvedValue(reservation());
    etat.motsDePasseAcceptes.add(motDePassePin("u1", "1234"));
    expect(await verifierPin(USER, "1234")).toEqual({ ok: true });
    const [nom, args] = etat.rpc.mock.calls[0]!;
    expect(nom).toBe("reserver_essai_pin");
    expect(args).toMatchObject({ p_user_id: "u1", p_max_ip: ESSAIS_MAX_IP, p_max_compte: ESSAIS_MAX_COMPTE });
    expect(JSON.stringify(args)).not.toContain("203.0.113.7");
    // Succès : les compteurs sont remis à zéro.
    expect(table("pin_essais").delete).toHaveBeenCalled();
  });

  it("essai refusé par le verrou : 429 sans même tester le PIN", async () => {
    etat.rpc.mockResolvedValue(reservation({ autorise: false, restants: 0, verrou_jusqua: new Date(Date.now() + 10 * 60000).toISOString() }));
    etat.motsDePasseAcceptes.add(motDePassePin("u1", "1234"));
    const r = await verifierPin(USER, "1234");
    expect(r).toMatchObject({ ok: false, status: 429 });
    expect(table("pin_essais").delete).not.toHaveBeenCalled();
  });

  it("mauvais PIN : 401 avec le nombre d'essais restants", async () => {
    etat.rpc.mockResolvedValue(reservation({ restants: 3 }));
    const r = await verifierPin(USER, "0000");
    expect(r).toEqual({ ok: false, status: 401, error: "Code PIN incorrect (3 essais restants)." });
  });

  it("verrou d'une adresse seule : journalisé, pas d'alerte à la direction", async () => {
    etat.rpc.mockResolvedValue(reservation({ restants: 0, vient_de_verrouiller: true, portee: "ip" }));
    const r = await verifierPin(USER, "0000");
    expect(r).toMatchObject({ ok: false, status: 429 });
    expect(table("alerts").insert).not.toHaveBeenCalled();
    expect(etat.journaliser).toHaveBeenCalledWith(expect.objectContaining({ action: "pin_bloque", details: expect.objectContaining({ portee: "ip" }) }));
  });

  it("verrou du compte (toutes adresses) : alerte critique à la direction", async () => {
    etat.rpc.mockResolvedValue(reservation({ restants: 0, vient_de_verrouiller: true, portee: "compte" }));
    const r = await verifierPin(USER, "0000");
    expect(r).toMatchObject({ ok: false, status: 429 });
    expect(table("alerts").insert).toHaveBeenCalledWith(expect.objectContaining({ severity: "critical", recipient_roles: ["direction"] }));
  });

  it("essais en parallèle : seuls les 5 premiers atteignent la vérification", async () => {
    let essais = 0;
    etat.rpc.mockImplementation(async () => {
      essais += 1;
      return essais <= ESSAIS_MAX_IP ? reservation({ restants: ESSAIS_MAX_IP - essais, vient_de_verrouiller: essais === ESSAIS_MAX_IP }) : reservation({ autorise: false, restants: 0, verrou_jusqua: new Date(Date.now() + 900000).toISOString() });
    });
    const resultats = await Promise.all(Array.from({ length: 30 }, () => verifierPin(USER, "9999")));
    expect(resultats.filter((r) => !r.ok && r.status === 401)).toHaveLength(ESSAIS_MAX_IP - 1);
    expect(resultats.filter((r) => !r.ok && r.status === 429)).toHaveLength(30 - (ESSAIS_MAX_IP - 1));
  });
});

describe("anciens PIN et migration non appliquée", () => {
  it("PIN en clair historique : accepté, puis re-haché avec PIN_PEPPER à la connexion", async () => {
    etat.rpc.mockResolvedValue(reservation());
    // Accepte le PIN en clair, puis le mot de passe dérivé une fois mis à jour.
    etat.motsDePasseAcceptes.add("1234");
    etat.updateUserById.mockImplementationOnce(async () => {
      etat.motsDePasseAcceptes.add(motDePassePin("u1", "1234"));
      return { error: null };
    });
    expect(await verifierPin(USER, "1234")).toEqual({ ok: true });
    expect(etat.updateUserById).toHaveBeenCalledWith("u1", { password: motDePassePin("u1", "1234") });
  });

  it("fonction SQL absente : ancien compteur (pin_login_attempts) conservé", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    etat.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "absente" } });
    etat.legacy = { failed_count: 4, locked_until: null };
    const r = await verifierPin(USER, "0000");
    expect(r).toMatchObject({ ok: false, status: 429 });
    expect(table("pin_login_attempts").upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", failed_count: 0 }));
    expect(table("alerts").insert).toHaveBeenCalled();
  });

  it("ancien verrou encore actif : refus", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    etat.rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "absente" } });
    etat.legacy = { failed_count: 0, locked_until: new Date(Date.now() + 5 * 60000).toISOString() };
    expect(await verifierPin(USER, "1234")).toMatchObject({ ok: false, status: 429 });
  });
});
