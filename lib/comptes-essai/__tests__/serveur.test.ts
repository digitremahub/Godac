import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { chargerComptes } from "@/lib/comptes-essai/serveur";
import { fakeDb } from "../../planning/__tests__/_fake-db";

const MAINTENANT = new Date("2026-11-16T10:00:00Z");
const jours = (n: number) => new Date(MAINTENANT.getTime() + n * 24 * 3600 * 1000).toISOString();
const [GO, CLASSIQUE, DEMO, SUSP, PARRAIN] = ["g1", "c1", "d1", "s1", "p1"];

function base() {
  return {
    organizations: [
      { id: GO, name: "GO Navigation – Jean Dupont", plan: "starter", created_at: jours(-20), subscription_status: "trialing", offre: "go_navigation", trial_ends_at: jours(10), is_demo: false, referred_by_user_id: "ua", referred_by_org_id: PARRAIN, suspendue_le: null },
      { id: CLASSIQUE, name: "Transports Martin", plan: "pro", created_at: jours(-300), subscription_status: "active", offre: null, trial_ends_at: null, is_demo: false, referred_by_user_id: null, referred_by_org_id: null, suspendue_le: null },
      { id: DEMO, name: "Démo GODAC", plan: "pro", created_at: jours(-400), subscription_status: "active", offre: null, trial_ends_at: null, is_demo: true, referred_by_user_id: null, referred_by_org_id: null, suspendue_le: null },
      { id: SUSP, name: "Fret Suspendu", plan: "starter", created_at: jours(-60), subscription_status: "trialing", offre: "go_navigation", trial_ends_at: jours(-30), is_demo: false, referred_by_user_id: null, referred_by_org_id: null, suspendue_le: jours(-1), suspendue_motif: "impayé", suspendue_par: "staff@godac.fr" },
      { id: PARRAIN, name: "Transports Parrain", plan: "pro", created_at: jours(-500), subscription_status: "active", offre: null, trial_ends_at: null, is_demo: false, referred_by_user_id: null, referred_by_org_id: null, suspendue_le: null },
    ],
    users: [
      { id: "u1", organization_id: GO, role: "direction", email: "jean@dupont.fr", active: true, pending_approval: false, created_at: jours(-20), full_name: "Jean" },
      { id: "u2", organization_id: GO, role: "chauffeur", email: "ch@dupont.fr", active: true, pending_approval: false, created_at: jours(-19), full_name: "Chauf" },
      { id: "u3", organization_id: GO, role: "chauffeur", email: "off@dupont.fr", active: false, pending_approval: false, created_at: jours(-18), full_name: "Parti" },
      { id: "u4", organization_id: GO, role: "chauffeur", email: "att@dupont.fr", active: true, pending_approval: true, created_at: jours(-2), full_name: "Attente" },
      { id: "u5", organization_id: CLASSIQUE, role: "direction", email: "dir@martin.fr", active: true, pending_approval: false, created_at: jours(-300), full_name: "Martin" },
      { id: "u6", organization_id: DEMO, role: "direction", email: "demo@godac.fr", active: true, pending_approval: false, created_at: jours(-400), full_name: "Demo" },
      { id: "ua", organization_id: PARRAIN, role: "direction", email: "parrain@x.fr", active: true, pending_approval: false, created_at: jours(-500), full_name: "Marie Curie" },
    ],
    organization_modules: [
      { organization_id: GO, module_key: "route_optimizer", enabled: true },
      { organization_id: GO, module_key: "mobile_app", enabled: true },
      { organization_id: GO, module_key: "ocr", enabled: false },
      { organization_id: DEMO, module_key: "fleet", enabled: true },
    ],
    delivery_runs: [
      { id: "r1", organization_id: GO, run_date: "2026-11-10", status: "done", created_at: jours(-6), started_at: jours(-6), optimized_at: null },
      { id: "r2", organization_id: GO, run_date: "2026-11-14", status: "planned", created_at: jours(-2), started_at: null, optimized_at: null },
      { id: "r0", organization_id: GO, run_date: "2026-08-01", status: "done", created_at: jours(-100), started_at: jours(-100), optimized_at: null },
    ],
    delivery_stops: [
      { organization_id: GO, run_id: "r1", status: "delivered", created_at: jours(-6), done_at: jours(-5) },
      { organization_id: GO, run_id: "r1", status: "failed", created_at: jours(-6), done_at: jours(-5) },
      { organization_id: GO, run_id: "r0", status: "delivered", created_at: jours(-100), done_at: jours(-100) },
    ],
    usage_events: [
      { organization_id: GO, feature: "route_optimization", units: 3, created_at: jours(-3) },
      { organization_id: GO, feature: "ocr_label", units: 40, created_at: jours(-3) },
    ],
  };
}

const auth = (connexions: Record<string, string>, erreur = false) => ({
  admin: { listUsers: async () => (erreur ? { data: null, error: { message: "boom" } } : { data: { users: Object.entries(connexions).map(([id, last_sign_in_at]) => ({ id, last_sign_in_at })) }, error: null }) },
});
const admin = (tables: Record<string, Record<string, unknown>[]>, connexions: Record<string, string> = {}, erreurAuth = false) => Object.assign(fakeDb(tables as never), { auth: auth(connexions, erreurAuth) });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("chargerComptes", () => {
  it("liste toutes les organisations hors démonstration", async () => {
    const r = await chargerComptes(admin(base()) as never, null, MAINTENANT);
    expect(r?.lignes.map((l) => l.id).sort()).toEqual([CLASSIQUE, GO, PARRAIN, SUSP].sort());
    expect(r?.lignes.find((l) => l.id === DEMO)).toBeUndefined();
    expect(r?.suspensionDisponible).toBe(true);
  });

  it("compte d'essai : statut, jours restants, offre, apporteur, utilisateurs actifs, e-mail direction, modules", async () => {
    const r = await chargerComptes(admin(base(), { u1: jours(-1), u2: jours(-8) }) as never, null, MAINTENANT);
    const l = r!.lignes.find((x) => x.id === GO)!;
    expect(l).toMatchObject({ offre: "go_navigation", statut: "essai_en_cours", joursRestants: 10, plan: "starter", abonnement: "trialing", emailDirection: "jean@dupont.fr", apporteur: "Marie Curie (Transports Parrain)" });
    // 2 actifs : le compte désactivé et l'inscription en attente ne comptent pas.
    expect(l.utilisateursActifs).toBe(2);
    expect(l.modules).toEqual(["mobile_app", "route_optimizer"]);
  });

  it("volume récent : seules les 30 dernières journées comptent (tournées, arrêts, optimisations, étiquettes)", async () => {
    const r = await chargerComptes(admin(base()) as never, null, MAINTENANT);
    const l = r!.lignes.find((x) => x.id === GO)!;
    expect(l).toMatchObject({ tournees: 2, tourneesDemarrees: 1, arrets: 2, arretsLivres: 1, optimisations: 3, lecturesEtiquettes: 40 });
  });

  it("dernière activité : la connexion si elle est la plus récente, sinon la dernière action connue ; sinon aucune", async () => {
    const connexions = { u1: jours(-1) };
    const r = await chargerComptes(admin(base(), connexions) as never, null, MAINTENANT);
    const go = r!.lignes.find((x) => x.id === GO)!;
    expect(go.derniereActivite).toBe(jours(-1));
    expect(go.sourceActivite).toBe("connexion");

    const sans = await chargerComptes(admin(base()) as never, null, MAINTENANT);
    const go2 = sans!.lignes.find((x) => x.id === GO)!;
    expect(go2.derniereActivite).toBe(jours(-2)); // dernière tournée créée
    expect(go2.sourceActivite).toBe("activite");
    expect(sans!.lignes.find((x) => x.id === CLASSIQUE)).toMatchObject({ derniereActivite: null, sourceActivite: null });
  });

  it("connexions illisibles : la liste reste affichée avec l'activité connue", async () => {
    const r = await chargerComptes(admin(base(), {}, true) as never, null, MAINTENANT);
    expect(r!.lignes).toHaveLength(4);
  });

  it("compte suspendu : état, date, motif et auteur remontés ; statut « suspendu »", async () => {
    const r = await chargerComptes(admin(base()) as never, null, MAINTENANT);
    const s = r!.lignes.find((x) => x.id === SUSP)!;
    expect(s).toMatchObject({ statut: "suspendu", suspendueMotif: "impayé", suspenduePar: "staff@godac.fr", joursRestants: null });
    expect(s.suspendueLe).toBe(jours(-1));
  });

  it("organisation du staff repérée ; organisation abonnée hors essai", async () => {
    const r = await chargerComptes(admin(base()) as never, CLASSIQUE, MAINTENANT);
    expect(r!.lignes.find((x) => x.id === CLASSIQUE)).toMatchObject({ organisationDuStaff: true, statut: "abonne", offre: "autre", emailDirection: "dir@martin.fr" });
    expect(r!.lignes.filter((x) => x.organisationDuStaff)).toHaveLength(1);
  });

  it("aucune écriture : la lecture ne modifie rien", async () => {
    const t = base();
    const avant = JSON.stringify(t);
    await chargerComptes(admin(t) as never, null, MAINTENANT);
    expect(JSON.stringify(t)).toBe(avant);
  });

  it("organisations illisibles (erreur autre qu'une migration absente) : null", async () => {
    const casse = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) }) }) }) }), auth: auth({}) };
    expect(await chargerComptes(casse as never, null, MAINTENANT)).toBeNull();
  });

  it("migrations absentes : repli colonne par colonne, suspension indisponible", async () => {
    const reel = admin(base());
    let essais = 0;
    const sansSuspension = {
      auth: reel.auth,
      from: (nom: string) => {
        if (nom !== "organizations") return reel.from(nom);
        return {
          select: (colonnes: string) => {
            essais++;
            const q = reel.from(nom).select(colonnes);
            if (!colonnes.includes("suspendue_le")) return q;
            return { eq: () => ({ order: () => ({ range: async () => ({ data: null, error: { code: "42703", message: "column organizations.suspendue_le does not exist" } }) }) }) };
          },
        };
      },
    };
    const r = await chargerComptes(sansSuspension as never, null, MAINTENANT);
    expect(essais).toBeGreaterThanOrEqual(2);
    expect(r?.suspensionDisponible).toBe(false);
    expect(r?.lignes).toHaveLength(4);
  });
});
