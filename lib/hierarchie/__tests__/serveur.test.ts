import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit/journal", () => ({ journaliser: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: async () => new Set<string>() }));

import type { UserRole } from "@/lib/types/domain";
import { alerterNiveauSuperieur, compterDirection, destinatairesDe, garderDecision, lirePersonne } from "@/lib/hierarchie/serveur";

type Ligne = Record<string, unknown>;

/** Faux client Supabase : une table = une liste de lignes ; filtres eq / in appliqués, count et single gérés. */
function fauxClient(tables: Record<string, Ligne[]>) {
  const inserts: { table: string; lignes: Ligne[] }[] = [];
  const from = (table: string) => {
    let lignes = [...(tables[table] ?? [])];
    let compte = false;
    const chaine: Record<string, unknown> = {
      select: (_c?: string, opts?: { count?: string; head?: boolean }) => {
        compte = Boolean(opts?.count);
        return chaine;
      },
      eq: (col: string, val: unknown) => {
        lignes = lignes.filter((l) => l[col] === val);
        return chaine;
      },
      in: (col: string, vals: unknown[]) => {
        lignes = lignes.filter((l) => vals.includes(l[col]));
        return chaine;
      },
      maybeSingle: async () => ({ data: lignes[0] ?? null, error: null }),
      insert: async (l: Ligne | Ligne[]) => {
        inserts.push({ table, lignes: Array.isArray(l) ? l : [l] });
        return { error: null };
      },
      then: (ok: (v: unknown) => unknown) => ok(compte ? { count: lignes.length, data: null, error: null } : { data: lignes, error: null }),
    };
    return chaine;
  };
  return { client: { from } as never, inserts };
}

const org = "o1";
const users: Ligne[] = [
  { id: "c1", organization_id: org, role: "chauffeur", active: true },
  { id: "m1", organization_id: org, role: "manager", active: true },
  { id: "m2", organization_id: org, role: "manager", active: true },
  { id: "e1", organization_id: org, role: "exploitation", active: true },
  { id: "d1", organization_id: org, role: "direction", active: true },
  { id: "d2", organization_id: org, role: "direction", active: true },
  { id: "d3", organization_id: org, role: "direction", active: false },
  { id: "x1", organization_id: "autre", role: "direction", active: true },
];
const services: Ligne[] = [
  { user_id: "c1", service_id: "s1" },
  { user_id: "m1", service_id: "s1" },
  { user_id: "m2", service_id: "s2" },
];
const moi = (id: string, role: string) => ({ id, role: role as UserRole, organization_id: org });

describe("compterDirection", () => {
  it("compte les directions actives de l'organisation seulement", async () => {
    expect(await compterDirection(fauxClient({ users }).client, org)).toBe(2);
  });
});

describe("lirePersonne", () => {
  it("rôle et services ; une autre organisation est introuvable", async () => {
    const { client } = fauxClient({ users, user_services: services });
    expect(await lirePersonne(client, org, "c1")).toEqual({ id: "c1", role: "chauffeur", serviceIds: ["s1"] });
    expect(await lirePersonne(client, org, "x1")).toBeNull();
  });
});

describe("garderDecision", () => {
  const { client } = fauxClient({ users, user_services: services });

  it("403 clair quand un manager décide de sa propre demande", async () => {
    const r = await garderDecision(client, moi("m1", "manager"), "m1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reponse.status).toBe(403);
      const json = await r.reponse.json();
      expect(json.error).toBe("Vous ne pouvez pas décider de votre propre demande : elle doit être traitée par l'exploitation ou la direction.");
      expect(json.code).toBe("ROLE_REFUSE");
    }
  });

  it("un manager ne décide pas la demande d'un autre manager, mais celle d'un chauffeur", async () => {
    expect((await garderDecision(client, moi("m1", "manager"), "m2")).ok).toBe(false);
    expect((await garderDecision(client, moi("m1", "manager"), "c1")).ok).toBe(true);
  });

  it("exploitation décide pour un manager ; direction pour tout le monde", async () => {
    expect((await garderDecision(client, moi("e1", "exploitation"), "m1")).ok).toBe(true);
    expect((await garderDecision(client, moi("d1", "direction"), "e1")).ok).toBe(true);
  });

  it("deux directions : pas d'auto-validation, mais l'autre décide", async () => {
    expect((await garderDecision(client, moi("d1", "direction"), "d1")).ok).toBe(false);
    expect(await garderDecision(client, moi("d1", "direction"), "d2")).toEqual({ ok: true, autoValidee: false });
  });

  it("direction unique : auto-validée", async () => {
    const seul = fauxClient({ users: users.filter((u) => u.id !== "d2"), user_services: services }).client;
    expect(await garderDecision(seul, moi("d1", "direction"), "d1")).toEqual({ ok: true, autoValidee: true });
  });

  it("le comptable ne décide que sur la paie", async () => {
    expect((await garderDecision(client, moi("k1", "comptable"), "c1")).ok).toBe(false);
    expect((await garderDecision(client, moi("k1", "comptable"), "c1", { paie: true })).ok).toBe(true);
  });

  it("demandeur introuvable : seule la règle de la propre demande joue", async () => {
    expect((await garderDecision(client, moi("m1", "manager"), "inconnu")).ok).toBe(true);
    expect((await garderDecision(client, moi("m1", "manager"), { id: "m1", role: "manager" })).ok).toBe(false);
  });
});

describe("routage des alertes", () => {
  it("destinatairesDe : manager du service pour un chauffeur", async () => {
    const { client } = fauxClient({ users, user_services: services });
    expect((await destinatairesDe(client, org, "c1")).map((u) => u.id)).toEqual(["m1"]);
  });

  it("alerterNiveauSuperieur : une alerte personnelle par destinataire, jamais le demandeur", async () => {
    const f = fauxClient({ users, user_services: services });
    const err = await alerterNiveauSuperieur(f.client, { organizationId: org, demandeurId: "m1", type: "x", severity: "info", message: "m", relatedTable: "t", relatedId: "r" });
    expect(err).toBeNull();
    const ids = f.inserts[0]!.lignes.map((l) => l.recipient_user_id).sort();
    expect(ids).toEqual(["d1", "d2", "e1"]);
  });

  it("direction unique : aucune alerte", async () => {
    const f = fauxClient({ users: users.filter((u) => u.id !== "d2"), user_services: services });
    await alerterNiveauSuperieur(f.client, { organizationId: org, demandeurId: "d1", type: "x", severity: "info", message: "m", relatedTable: "t", relatedId: "r" });
    expect(f.inserts).toEqual([]);
  });
});
