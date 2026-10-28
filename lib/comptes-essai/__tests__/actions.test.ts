import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const journal: { organizationId: string; userId: string | null; action: string; targetTable?: string; targetId?: string | null; details?: Record<string, unknown> }[] = [];
vi.mock("@/lib/audit/journal", () => ({ journaliser: async (p: never) => void journal.push(p) }));

import { appliquerAction } from "@/lib/comptes-essai/actions";
import { fakeDb } from "../../planning/__tests__/_fake-db";

const MAINTENANT = new Date("2026-11-16T10:00:00Z");
const jours = (n: number) => new Date(MAINTENANT.getTime() + n * 24 * 3600 * 1000).toISOString();
const O1 = "11111111-1111-4111-8111-111111111111";
const O2 = "22222222-2222-4222-8222-222222222222";
const DEMO = "33333333-3333-4333-8333-333333333333";
const STAFF_ORG = "44444444-4444-4444-8444-444444444444";

function tables() {
  return {
    organizations: [
      { id: O1, name: "GO Navigation – Jean Dupont", plan: "starter", offre: "go_navigation", subscription_status: "trialing", trial_ends_at: jours(10), is_demo: false, suspendue_le: null, suspendue_motif: null, suspendue_par: null },
      { id: O2, name: "Transports Martin", plan: "pro", offre: null, subscription_status: "active", trial_ends_at: null, is_demo: false, suspendue_le: null, suspendue_motif: null, suspendue_par: null },
      { id: DEMO, name: "Démo", plan: "pro", offre: null, subscription_status: "active", trial_ends_at: null, is_demo: true, suspendue_le: null, suspendue_motif: null, suspendue_par: null },
      { id: STAFF_ORG, name: "GODAC interne", plan: "pro", offre: null, subscription_status: "active", trial_ends_at: null, is_demo: false, suspendue_le: null, suspendue_motif: null, suspendue_par: null },
    ],
    users: [
      { id: "u1", organization_id: O1, role: "direction", active: true },
      { id: "u2", organization_id: O1, role: "chauffeur", active: true },
    ],
    go_navigation_invitations: [
      { id: "i1", created_by_org_id: O1, used_at: null, revoked_at: null, revoked_by_email: null },
      { id: "i2", created_by_org_id: O1, used_at: jours(-3), revoked_at: null, revoked_by_email: null },
      { id: "i3", created_by_org_id: O1, used_at: null, revoked_at: jours(-2), revoked_by_email: "ancien@godac.fr" },
      { id: "i4", created_by_org_id: O2, used_at: null, revoked_at: null, revoked_by_email: null },
      { id: "i5", created_by_org_id: "55555555-5555-4555-8555-555555555555", used_at: null, revoked_at: null, revoked_by_email: null },
    ],
    go_apporteur_liens: [
      { id: "l1", organization_id: O1, revoked_at: null },
      { id: "l2", organization_id: O1, revoked_at: jours(-9) },
      { id: "l3", organization_id: O2, revoked_at: null },
    ],
  };
}

let t: ReturnType<typeof tables>;
let admin: ReturnType<typeof fakeDb>;
const lancer = (action: Parameters<typeof appliquerAction>[1]["action"], extra: Partial<Parameters<typeof appliquerAction>[1]> = {}) =>
  appliquerAction(admin as never, { action, organisationId: O1, motif: "impayé depuis deux mois", par: "Staff@Godac.fr", organisationDuStaffId: STAFF_ORG, maintenant: MAINTENANT, ...extra });
const org = (id: string) => t.organizations.find((o) => o.id === id)!;

beforeEach(() => {
  journal.length = 0;
  t = tables();
  admin = fakeDb(t as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("suspendre", () => {
  it("pose la date, le motif et l'e-mail du staff ; trace au journal ; ne touche à rien d'autre", async () => {
    const avant = JSON.stringify({ users: t.users, inv: t.go_navigation_invitations, liens: t.go_apporteur_liens, autre: org(O2) });
    const r = await lancer("suspendre");
    expect(r).toMatchObject({ ok: true, action: "suspendre", suspensionPosee: true, invitationsRevoquees: 0, liensRevoques: 0 });
    expect(org(O1)).toMatchObject({ suspendue_le: MAINTENANT.toISOString(), suspendue_motif: "impayé depuis deux mois", suspendue_par: "staff@godac.fr" });
    // Aucune donnée effacée ni modifiée ailleurs.
    expect(JSON.stringify({ users: t.users, inv: t.go_navigation_invitations, liens: t.go_apporteur_liens, autre: org(O2) })).toBe(avant);
    expect(t.users).toHaveLength(2);
    expect(t.organizations).toHaveLength(4);
    expect(journal).toEqual([
      expect.objectContaining({ organizationId: O1, userId: null, action: "compte_suspendu", targetTable: "organizations", targetId: O1, details: expect.objectContaining({ motif: "impayé depuis deux mois", par: "staff@godac.fr", organisation: "GO Navigation – Jean Dupont" }) }),
    ]);
  });
  it("déjà suspendu : 409, motif d'origine conservé, rien au journal", async () => {
    await lancer("suspendre");
    journal.length = 0;
    const r = await lancer("suspendre", { motif: "autre motif valable" });
    expect(r).toMatchObject({ ok: false, statut: 409, code: "DEJA_SUSPENDU" });
    expect(org(O1).suspendue_motif).toBe("impayé depuis deux mois");
    expect(journal).toEqual([]);
  });
  it("motif absent ou trop court : 400, rien écrit", async () => {
    for (const motif of [undefined, "", "   ", "abc"]) {
      expect(await lancer("suspendre", { motif })).toMatchObject({ ok: false, statut: 400, code: "MOTIF_REQUIS" });
    }
    expect(org(O1).suspendue_le).toBeNull();
    expect(journal).toEqual([]);
  });
  it("organisation de démonstration : refusée, rien écrit", async () => {
    expect(await lancer("suspendre", { organisationId: DEMO })).toMatchObject({ ok: false, statut: 409, code: "ORGANISATION_DEMO" });
    expect(org(DEMO).suspendue_le).toBeNull();
    expect(journal).toEqual([]);
  });
  it("organisation inconnue : 404", async () => {
    expect(await lancer("suspendre", { organisationId: "99999999-9999-4999-8999-999999999999" })).toMatchObject({ ok: false, statut: 404 });
  });
  it("organisation du staff : nom exact requis, puis accepté et signalé au journal", async () => {
    const sans = await lancer("suspendre", { organisationId: STAFF_ORG });
    expect(sans).toMatchObject({ ok: false, statut: 409, code: "CONFIRMATION_RENFORCEE" });
    expect(org(STAFF_ORG).suspendue_le).toBeNull();
    const faux = await lancer("suspendre", { organisationId: STAFF_ORG, confirmationNom: "GODAC" });
    expect(faux).toMatchObject({ ok: false, code: "CONFIRMATION_RENFORCEE" });
    const bon = await lancer("suspendre", { organisationId: STAFF_ORG, confirmationNom: "GODAC interne" });
    expect(bon.ok).toBe(true);
    expect(org(STAFF_ORG).suspendue_le).not.toBeNull();
    expect(journal[0]?.details).toMatchObject({ organisation_du_staff: true });
  });
});

describe("rétablir", () => {
  it("lève la suspension (trois colonnes à null), trace, ne supprime rien", async () => {
    await lancer("suspendre");
    journal.length = 0;
    const r = await lancer("retablir", { motif: "régularisé le 20/11" });
    expect(r).toMatchObject({ ok: true, action: "retablir" });
    expect(org(O1)).toMatchObject({ suspendue_le: null, suspendue_motif: null, suspendue_par: null });
    expect(journal.map((j) => j.action)).toEqual(["compte_retabli"]);
    expect(journal[0]?.details).toMatchObject({ motif: "régularisé le 20/11", par: "staff@godac.fr" });
    expect(t.users).toHaveLength(2);
  });
  it("compte non suspendu : 409", async () => {
    expect(await lancer("retablir")).toMatchObject({ ok: false, statut: 409, code: "PAS_SUSPENDU" });
    expect(journal).toEqual([]);
  });
  it("sa propre organisation se rétablit sans nom retapé", async () => {
    await lancer("suspendre", { organisationId: STAFF_ORG, confirmationNom: "GODAC interne" });
    expect((await lancer("retablir", { organisationId: STAFF_ORG })).ok).toBe(true);
  });
});

describe("révoquer", () => {
  it("suspend et invalide les invitations non utilisées et les liens de CETTE organisation seulement", async () => {
    const r = await lancer("revoquer");
    expect(r).toMatchObject({ ok: true, action: "revoquer", suspensionPosee: true, invitationsRevoquees: 1, liensRevoques: 1 });
    expect(org(O1).suspendue_le).not.toBeNull();
    const inv = (id: string) => t.go_navigation_invitations.find((i) => i.id === id)!;
    expect(inv("i1")).toMatchObject({ revoked_at: MAINTENANT.toISOString(), revoked_by_email: "staff@godac.fr" });
    expect(inv("i2").revoked_at).toBeNull(); // déjà utilisée : le compte créé n'est pas touché
    expect(inv("i3").revoked_by_email).toBe("ancien@godac.fr"); // déjà révoquée : inchangée
    expect(inv("i4").revoked_at).toBeNull(); // autre organisation
    expect(inv("i5").revoked_at).toBeNull(); // organisation tierce (les invitations du staff, sans organisation, ne sont jamais ciblées : filtre created_by_org_id = organisation)
    const lien = (id: string) => t.go_apporteur_liens.find((l) => l.id === id)!;
    expect(lien("l1").revoked_at).toBe(MAINTENANT.toISOString());
    expect(lien("l2").revoked_at).toBe(jours(-9));
    expect(lien("l3").revoked_at).toBeNull();
    expect(t.users).toHaveLength(2);
    expect(t.go_navigation_invitations).toHaveLength(5);
    expect(journal.map((j) => j.action)).toEqual(["compte_revoque"]);
    expect(journal[0]?.details).toMatchObject({ suspension_posee: true, invitations_revoquees: 1, liens_revoques: 1 });
  });
  it("déjà suspendu : conserve la suspension d'origine et révoque quand même", async () => {
    await lancer("suspendre");
    const r = await lancer("revoquer", { motif: "fraude confirmée" });
    expect(r).toMatchObject({ ok: true, suspensionPosee: false, invitationsRevoquees: 1, liensRevoques: 1 });
    expect(org(O1).suspendue_motif).toBe("impayé depuis deux mois");
  });
  it("démo : refusée, invitations intactes", async () => {
    expect(await lancer("revoquer", { organisationId: DEMO })).toMatchObject({ ok: false, code: "ORGANISATION_DEMO" });
    expect(t.go_navigation_invitations.every((i) => i.revoked_at === null || i.id === "i3")).toBe(true);
  });
  it("tables de partage absentes (migration 20261103000003 non appliquée) : la suspension reste posée, sans erreur", async () => {
    delete (t as Partial<typeof t>).go_navigation_invitations;
    delete (t as Partial<typeof t>).go_apporteur_liens;
    const r = await lancer("revoquer");
    expect(r).toMatchObject({ ok: true, suspensionPosee: true, invitationsRevoquees: 0, liensRevoques: 0 });
    expect(r.ok && r.avertissement).toBeFalsy();
  });
});

describe("terminer l'essai", () => {
  it("avance trial_ends_at à maintenant et garde l'ancienne date au journal ; l'essai est alors terminé", async () => {
    const ancienne = org(O1).trial_ends_at;
    const r = await lancer("terminer_essai");
    expect(r).toMatchObject({ ok: true, action: "terminer_essai" });
    expect(org(O1).trial_ends_at).toBe(MAINTENANT.toISOString());
    expect(org(O1).suspendue_le).toBeNull();
    expect(journal[0]).toMatchObject({ action: "essai_termine_staff", details: expect.objectContaining({ ancienne_fin: ancienne }) });
    const { essaiTermine } = await import("@/lib/go-navigation/offre");
    expect(essaiTermine({ offre: "go_navigation", subscription_status: "trialing", trial_ends_at: org(O1).trial_ends_at }, MAINTENANT)).toBe(true);
  });
  it("refus : autre offre, abonné, essai déjà terminé", async () => {
    expect(await lancer("terminer_essai", { organisationId: O2 })).toMatchObject({ ok: false, code: "PAS_UN_ESSAI_GO" });
    org(O1).subscription_status = "active";
    expect(await lancer("terminer_essai")).toMatchObject({ ok: false, code: "DEJA_ABONNE" });
    org(O1).subscription_status = "trialing";
    org(O1).trial_ends_at = jours(-1);
    expect(await lancer("terminer_essai")).toMatchObject({ ok: false, code: "ESSAI_DEJA_TERMINE" });
    expect(journal).toEqual([]);
  });
  it("migration de suspension absente : la fin d'essai reste possible", async () => {
    const reel = admin.from.bind(admin);
    const erreur = { code: "42703", message: "column organizations.suspendue_le does not exist" };
    const sansSuspension = {
      from(nom: string) {
        const q = reel(nom);
        if (nom !== "organizations") return q;
        const select = q.select.bind(q);
        const envelopper = (colonnes?: string) => (colonnes?.includes("suspendue_le") ? { eq: () => ({ maybeSingle: async () => ({ data: null, error: erreur }) }) } : select(colonnes));
        return new Proxy(q, { get: (cible, prop) => (prop === "select" ? envelopper : (cible as never)[prop]) });
      },
    };
    const r = await appliquerAction(sansSuspension as never, { action: "terminer_essai", organisationId: O1, motif: "demande du client", par: "staff@godac.fr", organisationDuStaffId: null, maintenant: MAINTENANT });
    expect(r.ok).toBe(true);
    const r2 = await appliquerAction(sansSuspension as never, { action: "suspendre", organisationId: O1, motif: "demande du client", par: "staff@godac.fr", organisationDuStaffId: null, maintenant: MAINTENANT });
    expect(r2).toMatchObject({ ok: false, statut: 409, code: "MIGRATION_MANQUANTE" });
    expect(!r2.ok && r2.message).toContain("20261116000001");
  });
});
