import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let adminCourant: unknown = null;
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => adminCourant }));
let moduleActif = true;
vi.mock("@/lib/organization/modules", () => ({ isModuleEnabled: async () => moduleActif }));

import { actionPourArret, codeArret, sortiesAuDepart, type ArretTournee, type UniteLiee } from "@/lib/stock/integration-tournee-logique";
import { stockApresArret, stockApresCloture, stockAuDepartTournee } from "@/lib/stock/integration-tournee";
import { fakeDb } from "../../planning/__tests__/_fake-db";

const unite = (code: string, statut: UniteLiee["statut"], site_id: string | null = "site-1"): UniteLiee => ({ id: `u-${code}`, code, statut, site_id });
const arret = (id: string, parcel_code: string | null, status: ArretTournee["status"] = "pending"): ArretTournee => ({ id, parcel_code, status });

describe("départ de la tournée : sorties de stock", () => {
  it("sort les colis en stock, liés à la tournée et à l'arrêt, avec une clé par arrêt", () => {
    const actions = sortiesAuDepart("run-1", [arret("s1", "C1"), arret("s2", " C2 "), arret("s3", "C3"), arret("s4", null)], [unite("C1", "dans_depot"), unite("C2", "retour"), unite("C3", "livre")]);
    expect(actions).toEqual([
      { type: "sortie", code: "C1", site_id: "site-1", stop_id: "s1", statut_apres: "en_tournee", cle: "tournee:run-1:s1:depart" },
      { type: "sortie", code: "C2", site_id: "site-1", stop_id: "s2", statut_apres: "en_tournee", cle: "tournee:run-1:s2:depart" },
    ]);
  });
  it("ignore les arrêts déjà clôturés, les codes inconnus, les unités sans dépôt et les doublons", () => {
    const actions = sortiesAuDepart(
      "run-1",
      [arret("s1", "C1", "delivered"), arret("s2", "INCONNU"), arret("s3", "C3"), arret("s4", "C4"), arret("s5", "C4")],
      [unite("C1", "dans_depot"), unite("C3", "dans_depot", null), unite("C4", "dans_depot")],
    );
    expect(actions.map((a) => a.stop_id)).toEqual(["s4"]);
  });
  it("même résultat si la requête est rejouée (clés identiques)", () => {
    const a = sortiesAuDepart("run-1", [arret("s1", "C1")], [unite("C1", "dans_depot")]);
    const b = sortiesAuDepart("run-1", [arret("s1", "C1")], [unite("C1", "dans_depot")]);
    expect(a[0]!.cle).toBe(b[0]!.cle);
  });
  it("espaces autour du code ignorés", () => {
    expect(codeArret("  X1 ")).toBe("X1");
    expect(codeArret("   ")).toBeNull();
    expect(codeArret(undefined)).toBeNull();
  });
});

describe("livraison ou échec d'un arrêt", () => {
  it("livré : l'unité en tournée passe « livrée »", () => {
    expect(actionPourArret({ id: "s1", parcel_code: "C1" }, "delivered", [unite("C1", "en_tournee")])).toMatchObject({ type: "sortie", statut_apres: "livre", cle: "tournee:s1:livre" });
  });
  it("échec : l'unité en tournée passe « retour » (à rentrer)", () => {
    expect(actionPourArret({ id: "s1", parcel_code: "C1" }, "failed", [unite("C1", "en_tournee")])).toMatchObject({ type: "retour", statut_apres: "retour", cle: "tournee:s1:echec" });
  });
  it("rien à faire si l'unité n'est pas en stock, déjà livrée, ou si le colis n'a pas de code", () => {
    expect(actionPourArret({ id: "s1", parcel_code: "C1" }, "delivered", [])).toBeNull();
    expect(actionPourArret({ id: "s1", parcel_code: "C1" }, "delivered", [unite("C1", "livre")])).toBeNull();
    expect(actionPourArret({ id: "s1", parcel_code: "C1" }, "failed", [unite("C1", "dans_depot")])).toBeNull();
    expect(actionPourArret({ id: "s1", parcel_code: null }, "delivered", [unite("C1", "en_tournee")])).toBeNull();
  });
  it("livré après un échec (même tournée) : l'unité rentrée passe « livrée »", () => {
    expect(actionPourArret({ id: "s1", parcel_code: "C1" }, "delivered", [unite("C1", "retour")])).toMatchObject({ statut_apres: "livre" });
  });
});

/** Client dont chaque appel échoue : l'intégration ne doit rien propager. */
const clientCasse = () =>
  ({
    from() {
      throw new Error("base indisponible");
    },
    rpc() {
      throw new Error("base indisponible");
    },
  }) as never;

/** Client en mémoire : lectures des arrêts et des unités, appels de la fonction de mouvement enregistrés. */
function clientStock(tables: Record<string, unknown[]>, reponseRpc: { data?: unknown; error?: { code?: string; message: string } | null } = { data: { ok: true, doublon: false }, error: null }) {
  const rpc: { nom: string; params: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const filtres: ((l: any) => boolean)[] = [];
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtres.push((l) => l[c] === v), q),
        in: (c: string, vs: unknown[]) => (filtres.push((l) => vs.includes(l[c])), q),
        maybeSingle: () => Promise.resolve({ data: ((tables[table] ?? []) as any[]).find((l) => filtres.every((f) => f(l))) ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: ((tables[table] ?? []) as any[]).filter((l) => filtres.every((f) => f(l))), error: null }).then(ok),
      };
      return q;
    },
    rpc(nom: string, params: Record<string, unknown>) {
      rpc.push({ nom, params });
      return Promise.resolve({ data: reponseRpc.data ?? null, error: reponseRpc.error ?? null });
    },
  } as never;
  return { client, rpc };
}

describe("intégration tolérante : le flux colis n'est jamais bloqué", () => {
  // Une organisation par test : le résultat « module actif » est mémorisé quelques secondes par organisation.
  let n = 0;
  let user = { id: "u1", organization_id: "o1" };
  beforeEach(() => {
    user = { id: "u1", organization_id: `org-${++n}` };
    moduleActif = true;
    adminCourant = fakeDb({});
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  const tables = () => ({
    delivery_stops: [
      { id: "s1", organization_id: user.organization_id, run_id: "r1", parcel_code: "C1", status: "pending" },
      { id: "s2", organization_id: user.organization_id, run_id: "r1", parcel_code: "C2", status: "pending" },
    ],
    stock_unites: [
      { id: "u-C1", organization_id: user.organization_id, code: "C1", statut: "dans_depot", site_id: "site-1" },
      { id: "u-C2", organization_id: user.organization_id, code: "C2", statut: "en_tournee", site_id: "site-1" },
    ],
  });

  it("base indisponible : aucune exception", async () => {
    await expect(stockAuDepartTournee(clientCasse(), user, "r1")).resolves.toBeUndefined();
    await expect(stockApresArret(clientCasse(), user, { id: "s1", run_id: "r1", parcel_code: "C1" }, "delivered")).resolves.toBeUndefined();
    await expect(stockApresCloture(clientCasse(), user)).resolves.toBeUndefined();
  });

  it("module Stock inactif : aucune lecture de stock, aucun mouvement", async () => {
    moduleActif = false;
    const { client, rpc } = clientStock(tables());
    await stockAuDepartTournee(client, user, "r1");
    await stockApresArret(client, user, { id: "s1", run_id: "r1", parcel_code: "C1" }, "failed");
    await stockApresCloture(client, user);
    expect(rpc).toEqual([]);
  });

  it("module actif, départ : une sortie « en tournée » pour le seul colis en stock au dépôt", async () => {
    const { client, rpc } = clientStock(tables());
    await stockAuDepartTournee(client, user, "r1");
    expect(rpc).toHaveLength(1);
    expect(rpc[0]).toMatchObject({
      nom: "stock_enregistrer_mouvement",
      params: { p_cle: "tournee:r1:s1:depart", p_type: "sortie", p_site: "site-1", p_unite_code: "C1", p_statut_apres: "en_tournee", p_run: "r1", p_stop: "s1", p_source: "tournee", p_motif: null },
    });
  });

  it("module actif, livraison puis échec : « livré » et « retour »", async () => {
    const { client, rpc } = clientStock(tables());
    await stockApresArret(client, user, { id: "s2", run_id: "r1", parcel_code: "C2" }, "delivered");
    await stockApresArret(client, user, { id: "s2", run_id: "r1", parcel_code: "C2" }, "failed");
    expect(rpc.map((r) => [r.params.p_type, r.params.p_statut_apres, r.params.p_cle])).toEqual([
      ["sortie", "livre", "tournee:s2:livre"],
      ["retour", "retour", "tournee:s2:echec"],
    ]);
  });

  it("le code du colis est relu depuis l'arrêt quand l'appelant ne le fournit pas", async () => {
    const { client, rpc } = clientStock(tables());
    await stockApresArret(client, user, { id: "s2", run_id: "r1" }, "delivered");
    expect(rpc).toHaveLength(1);
  });

  it("erreur de la fonction de mouvement : consignée, jamais propagée", async () => {
    const { client, rpc } = clientStock(tables(), { error: { message: "stock_transition_interdite" } });
    await expect(stockAuDepartTournee(client, user, "r1")).resolves.toBeUndefined();
    expect(rpc).toHaveLength(1);
  });

  it("migrations non appliquées (table absente) : rien ne casse", async () => {
    const client = {
      from() {
        const q: any = { select: () => q, eq: () => q, in: () => q, maybeSingle: () => Promise.resolve({ data: null, error: null }), then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "stock_unites" does not exist' } }).then(ok) };
        return q;
      },
      rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
    } as never;
    await expect(stockAuDepartTournee(client, user, "r1")).resolves.toBeUndefined();
    await expect(stockApresArret(client, user, { id: "s1", run_id: "r1", parcel_code: "C1" }, "delivered")).resolves.toBeUndefined();
  });
});
