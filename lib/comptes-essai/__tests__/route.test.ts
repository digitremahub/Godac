import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const journal: { action: string; organizationId: string; details?: Record<string, unknown> }[] = [];
vi.mock("@/lib/audit/journal", () => ({ journaliser: async (p: never) => void journal.push(p) }));

let utilisateur: { id: string; email: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: utilisateur } }) } }) }));
let db: ReturnType<typeof fakeDb>;
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => db }));

import { POST } from "@/app/api/godac-staff/comptes-essai/[id]/route";
import { fakeDb } from "../../planning/__tests__/_fake-db";

const O1 = "11111111-1111-4111-8111-111111111111";
const DEMO = "33333333-3333-4333-8333-333333333333";
const MON_ORG = "44444444-4444-4444-8444-444444444444";
const futur = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();

const requete = (corps: unknown) => new Request("http://x/api/godac-staff/comptes-essai/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof corps === "string" ? corps : JSON.stringify(corps) });
const appeler = (id: string, corps: unknown) => POST(requete(corps), { params: Promise.resolve({ id }) });
const org = (id: string) => (db.tables.organizations as Record<string, unknown>[]).find((o) => o.id === id)!;

beforeEach(() => {
  journal.length = 0;
  process.env.GODAC_STAFF_EMAILS = "staff@godac.fr, autre@godac.fr";
  utilisateur = { id: "staff1", email: "Staff@Godac.fr" };
  db = fakeDb({
    organizations: [
      { id: O1, name: "Transports Dupont", offre: "go_navigation", subscription_status: "trialing", trial_ends_at: futur, is_demo: false, suspendue_le: null },
      { id: DEMO, name: "Démo", offre: null, subscription_status: "active", is_demo: true, suspendue_le: null },
      { id: MON_ORG, name: "GODAC interne", offre: null, subscription_status: "active", is_demo: false, suspendue_le: null },
    ],
    users: [{ id: "staff1", organization_id: MON_ORG }],
    go_navigation_invitations: [],
    go_apporteur_liens: [],
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.GODAC_STAFF_EMAILS;
});

describe("POST /api/godac-staff/comptes-essai/[id] : accès", () => {
  it("non connecté : 403, rien écrit", async () => {
    utilisateur = null;
    const r = await appeler(O1, { action: "suspendre", motif: "impayé répété" });
    expect(r.status).toBe(403);
    expect(org(O1).suspendue_le).toBeNull();
    expect(journal).toEqual([]);
  });
  it("utilisateur client (hors liste staff), même direction : 403, rien écrit", async () => {
    utilisateur = { id: "client1", email: "direction@client.fr" };
    for (const action of ["suspendre", "retablir", "revoquer", "terminer_essai"]) {
      const r = await appeler(O1, { action, motif: "tentative d'un client" });
      expect(r.status, action).toBe(403);
      expect(await r.json()).toEqual({ error: "Accès réservé au personnel GODAC" });
    }
    expect(org(O1).suspendue_le).toBeNull();
    expect(org(O1).trial_ends_at).toBe(futur);
    expect(journal).toEqual([]);
  });
  it("liste staff vide ou absente : personne n'a accès", async () => {
    process.env.GODAC_STAFF_EMAILS = "";
    expect((await appeler(O1, { action: "suspendre", motif: "impayé répété" })).status).toBe(403);
    delete process.env.GODAC_STAFF_EMAILS;
    expect((await appeler(O1, { action: "suspendre", motif: "impayé répété" })).status).toBe(403);
  });
});

describe("POST /api/godac-staff/comptes-essai/[id] : requête", () => {
  it("identifiant invalide : 404", async () => {
    expect((await appeler("pas-un-uuid", { action: "suspendre", motif: "impayé répété" })).status).toBe(404);
  });
  it("corps invalide, action inconnue, motif absent : 400 avec message français", async () => {
    for (const corps of ["pas du json", { action: "supprimer", motif: "impayé répété" }, { action: "suspendre" }, { action: "suspendre", motif: "non" }]) {
      const r = await appeler(O1, corps);
      expect(r.status, JSON.stringify(corps)).toBe(400);
      expect(typeof (await r.json()).error).toBe("string");
    }
    expect(org(O1).suspendue_le).toBeNull();
  });
  it("organisation inconnue : 404", async () => {
    expect((await appeler("99999999-9999-4999-8999-999999999999", { action: "suspendre", motif: "impayé répété" })).status).toBe(404);
  });
});

describe("POST /api/godac-staff/comptes-essai/[id] : actions", () => {
  it("suspendre puis rétablir, avec traçabilité (e-mail du staff, motif, organisation)", async () => {
    const r = await appeler(O1, { action: "suspendre", motif: "impayé répété" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, action: "suspendre" });
    expect(org(O1)).toMatchObject({ suspendue_motif: "impayé répété", suspendue_par: "staff@godac.fr" });
    expect(org(O1).suspendue_le).toEqual(expect.any(String));
    expect(journal).toEqual([expect.objectContaining({ action: "compte_suspendu", organizationId: O1, details: expect.objectContaining({ motif: "impayé répété", par: "staff@godac.fr" }) })]);

    expect((await appeler(O1, { action: "suspendre", motif: "impayé répété" })).status).toBe(409);

    const b = await appeler(O1, { action: "retablir", motif: "régularisé" });
    expect(b.status).toBe(200);
    expect(org(O1).suspendue_le).toBeNull();
    expect(journal.map((j) => j.action)).toEqual(["compte_suspendu", "compte_retabli"]);
  });
  it("organisation de démonstration : 409, jamais modifiée", async () => {
    const r = await appeler(DEMO, { action: "suspendre", motif: "essai sur la démo" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "ORGANISATION_DEMO" });
    expect(org(DEMO).suspendue_le).toBeNull();
    expect(journal).toEqual([]);
  });
  it("sa propre organisation : confirmation renforcée (nom exact) exigée", async () => {
    const sans = await appeler(MON_ORG, { action: "suspendre", motif: "test de suspension" });
    expect(sans.status).toBe(409);
    expect(await sans.json()).toMatchObject({ code: "CONFIRMATION_RENFORCEE" });
    expect(org(MON_ORG).suspendue_le).toBeNull();
    const avec = await appeler(MON_ORG, { action: "suspendre", motif: "test de suspension", confirmation_nom: "GODAC interne" });
    expect(avec.status).toBe(200);
    expect(org(MON_ORG).suspendue_le).toEqual(expect.any(String));
  });
  it("terminer l'essai maintenant : l'essai est terminé, la date précédente est au journal", async () => {
    const r = await appeler(O1, { action: "terminer_essai", motif: "demande du client" });
    expect(r.status).toBe(200);
    expect(Date.parse(org(O1).trial_ends_at as string)).toBeLessThanOrEqual(Date.now());
    expect(journal[0]).toMatchObject({ action: "essai_termine_staff", details: expect.objectContaining({ ancienne_fin: futur }) });
  });
});
