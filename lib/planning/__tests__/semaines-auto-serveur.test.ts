import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const journal = vi.fn();
vi.mock("@/lib/audit/journal", () => ({ journaliser: (p: unknown) => journal(p) }));
let adminCourant: unknown = null;
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => adminCourant }));

import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { confirmerSemaine, envoyerSemainesAuto, genererSemaine, lireLignesPlanning, MESSAGE_MIGRATION_MANQUANTE } from "@/lib/planning/semaines-auto-serveur";
import { noterModificationPlanning, semainesMasqueesDe } from "@/lib/planning/suivi-auto-serveur";
import { estMasquee, type LigneSuivi } from "@/lib/planning/semaines-auto";
import { fakeDb, type FakeDb } from "./_fake-db";

const at = (date: string, heure: string) => parisWallTimeToUtcISOString(date, heure);
const ORG = "o1";
const S1 = "s1";
const LUNDI = "2026-11-09";

/** Base de départ : un service Colis, trois chauffeurs, trois tournées sur la semaine du 2 novembre. */
function base(extra: Record<string, any[]> = {}) {
  const entree = (id: string, tour: string, driver: string | null, vehicle: string | null, jour: string, heure: string, p: Record<string, unknown> = {}) => ({
    id,
    organization_id: ORG,
    service_id: S1,
    tour_number: tour,
    driver_id: driver,
    vehicle_id: vehicle,
    start_at: at(jour, heure),
    status: "planned",
    tour_open: true,
    ...p,
  });
  return fakeDb({
    services: [{ id: S1, organization_id: ORG, name: "Colis", pole: null }, { id: "bureau", organization_id: ORG, name: "Siège", pole: "administratif" }],
    users: [
      { id: "d1", organization_id: ORG, full_name: "Dupont", active: true, role: "chauffeur" },
      { id: "d2", organization_id: ORG, full_name: "Martin", active: true, role: "chauffeur" },
      { id: "dir", organization_id: ORG, full_name: "Direction", active: true, role: "direction", created_at: "2025-01-01" },
    ],
    employee_files: [],
    leave_requests: [],
    work_stoppages: [],
    planning_entries: [
      entree("a1", "12", "d1", "v1", "2026-11-02", "07:00"),
      entree("a2", "12", "d1", "v1", "2026-11-03", "07:00"),
      entree("a3", "14", "d2", "v2", "2026-11-02", "08:30"),
    ],
    planning_tour_templates: [],
    planning_validations: [],
    planning_semaines_auto: [],
    alerts: [],
    ...extra,
  });
}

const entreesCible = (db: FakeDb) => db.ligne("planning_entries").filter((e) => e.start_at >= at(LUNDI, "00:00") && e.start_at < at("2026-11-16", "00:00"));
const suivi = (db: FakeDb) => db.ligne("planning_semaines_auto");

beforeEach(() => {
  journal.mockReset();
  adminCourant = null;
});

describe("genererSemaine : le jeudi, pour chaque service", () => {
  it("crée la semaine suivante NON publiée, la ligne de suivi, l'alerte d'encadrement et la trace d'audit", async () => {
    const db = base();
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services).toHaveLength(1);
    expect(bilan.services[0]).toMatchObject({ service: "Colis", statut: "generee", alerte: "creee" });
    expect(entreesCible(db).map((e) => [e.tour_number, e.driver_id, e.status]).sort()).toEqual([
      ["12", "d1", "planned"],
      ["12", "d1", "planned"],
      ["14", "d2", "planned"],
    ]);
    // Suivi : non modifiée, non confirmée, non publiée → invisible des chauffeurs (RLS) ; trigger muet (aucune planning_validations).
    expect(suivi(db)).toHaveLength(1);
    expect(suivi(db)[0]).toMatchObject({ service_id: S1, semaine_debut: LUNDI, genere_par: "auto", modifie_at: null, confirme_at: null, publie_at: null });
    expect(db.ligne("planning_validations")).toEqual([]);
    // Aucune notification pour un chauffeur.
    expect(db.ligne("alerts").some((a) => a.recipient_user_id)).toBe(false);
    // Alerte d'encadrement : direction, exploitation, managers du service ; jamais chauffeur ni comptable.
    const alerte = db.ligne("alerts").find((a) => a.type === "planning_a_confirmer")!;
    expect(alerte).toMatchObject({ recipient_roles: ["manager", "exploitation", "direction"], service_id: S1, related_table: "planning_semaines_auto", related_id: suivi(db)[0]!.id, cle_dedoublonnage: `planning:a_confirmer:${S1}:${LUNDI}` });
    expect(alerte.message).toContain("Planning du lundi 9 au dimanche 15 novembre généré : à confirmer avant vendredi 17 h");
    expect(alerte.message).toContain("3 tournées planifiées, 2 chauffeurs affectés, 0 case à remplacer");
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ action: "planning_semaine_generee", userId: null, targetTable: "planning_semaines_auto", details: expect.objectContaining({ creees: 3, chauffeurs: 2, a_remplacer: 0 }) }));
  });

  it("idempotent : une seconde exécution ne refait rien (la ligne de suivi bloque)", async () => {
    const db = base();
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    const avant = entreesCible(db).length;
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services[0]).toMatchObject({ statut: "deja" });
    expect(entreesCible(db)).toHaveLength(avant);
    expect(suivi(db)).toHaveLength(1);
    expect(db.ligne("alerts").filter((a) => a.type === "planning_a_confirmer")).toHaveLength(1);
    expect(journal).toHaveBeenCalledTimes(1);
  });

  it("n'écrase rien : planning commencé à la main, seules les cases vides sont créées et la semaine est notée modifiée", async () => {
    const main = { id: "m1", organization_id: ORG, service_id: S1, tour_number: "12", driver_id: "d2", vehicle_id: "v9", start_at: at("2026-11-09", "06:30"), status: "planned", tour_open: true };
    const db = base({ planning_entries: [...base().ligne("planning_entries"), main] });
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services[0]!.statut).toBe("generee");
    // La ligne posée à la main est intacte ; la tournée 12 du lundi n'est pas recopiée par-dessus.
    expect(db.ligne("planning_entries").find((e) => e.id === "m1")).toMatchObject({ driver_id: "d2", vehicle_id: "v9", start_at: at("2026-11-09", "06:30") });
    expect(entreesCible(db).filter((e) => e.tour_number === "12" && e.start_at.slice(0, 10) === "2026-11-09")).toHaveLength(1);
    expect(suivi(db)[0]!.modifie_at).not.toBeNull();
    expect(suivi(db)[0]!.resume.deja_presentes).toBe(1);
  });

  it("chauffeur en congé / arrêt : case « à remplacer », nommée sans motif", async () => {
    const db = base({
      leave_requests: [{ organization_id: ORG, driver_id: "d1", start_date: "2026-11-09", end_date: "2026-11-10", status: "approved" }],
      work_stoppages: [{ organization_id: ORG, user_id: "d2", stoppage_type: "maladie", start_date: "2026-11-09", end_date: "2026-11-20", status: "valide" }],
    });
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    const resume = bilan.services[0]!.resume!;
    expect(resume.a_remplacer).toBe(3);
    expect(entreesCible(db).filter((e) => !e.driver_id)).toHaveLength(3);
    expect(resume.absents.map((a) => a.entree_id).every(Boolean)).toBe(true);
    const alerte = db.ligne("alerts").find((a) => a.type === "planning_a_confirmer")!;
    expect(alerte.message).toContain("Dupont en congé du 09/11 au 10/11");
    expect(alerte.message).toContain("Martin absent");
    expect(JSON.stringify([alerte, suivi(db)])).not.toMatch(/maladie/i);
  });

  it("tournée fermée : non recopiée", async () => {
    const lignes = base().ligne("planning_entries").map((e) => (e.id === "a3" ? { ...e, tour_open: false } : e));
    const db = base({ planning_entries: lignes });
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(entreesCible(db).map((e) => e.tour_number)).toEqual(["12", "12"]);
    expect(suivi(db)[0]!.resume.fermees).toBe(1);
  });

  it("semaine déjà publiée pour le service : rien n'est généré", async () => {
    const db = base({ planning_validations: [{ organization_id: ORG, service_id: S1, week_start: LUNDI }] });
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services[0]!.statut).toBe("publiee");
    expect(entreesCible(db)).toHaveLength(0);
    expect(suivi(db)).toHaveLength(0);
  });

  it("rien à recopier ni modèle : pas de ligne de suivi", async () => {
    const db = base({ planning_entries: [] });
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services[0]!.statut).toBe("rien");
    expect(suivi(db)).toHaveLength(0);
  });

  it("les modèles comblent les tournées sans affectation", async () => {
    const db = base({ planning_tour_templates: [{ organization_id: ORG, service_id: S1, active: true, departure_time: "06:00:00", weekdays: [1, 2, 3], default_vehicle_id: null, tour_routes: { tour_number: "20" } }] });
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services[0]!.resume!.sans_chauffeur_modeles).toBe(3);
    expect(entreesCible(db).filter((e) => e.tour_number === "20" && !e.driver_id)).toHaveLength(3);
  });

  it("sans la migration (table de suivi absente) : génération sautée avec un message, jamais d'erreur", async () => {
    const tables = base();
    delete (tables.tables as any).planning_semaines_auto;
    const bilan = await genererSemaine(tables as any, ORG, { lundi: LUNDI });
    expect(bilan).toMatchObject({ migrationManquante: true, message: MESSAGE_MIGRATION_MANQUANTE, services: [] });
    expect(entreesCible(tables)).toHaveLength(0);
  });

  it("sans le type d'alerte (enum non appliquée) : la semaine est générée, l'alerte est seulement sautée", async () => {
    const db = base();
    const original = db.from.bind(db);
    (db as any).from = (nom: string) => {
      const r = original(nom) as any;
      if (nom !== "alerts") return r;
      r.insert = () => ({ then: (f: any) => Promise.resolve({ data: null, error: { code: "22P02", message: 'invalid input value for enum alert_type: "planning_a_confirmer"' } }).then(f) });
      return r;
    };
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services[0]).toMatchObject({ statut: "generee", alerte: "type_absent" });
    expect(entreesCible(db)).toHaveLength(3);
  });

  it("« Régénérer les cases vides » : ne crée que ce qui manque, note la semaine modifiée, ne duplique pas l'alerte", async () => {
    const db = base();
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    // Une ligne supprimée à la main : seule celle-là revient.
    const supprimee = entreesCible(db).find((e) => e.tour_number === "14")!;
    db.tables.planning_entries!.splice(db.tables.planning_entries!.indexOf(supprimee), 1);
    const avant = entreesCible(db).length;
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI, regenerer: true, userId: "dir" });
    expect(bilan.services[0]).toMatchObject({ statut: "regeneree", creees: 1 });
    expect(entreesCible(db)).toHaveLength(avant + 1);
    expect(suivi(db)[0]!.modifie_at).not.toBeNull();
    expect(db.ligne("alerts").filter((a) => a.type === "planning_a_confirmer")).toHaveLength(1);
    expect(journal).toHaveBeenLastCalledWith(expect.objectContaining({ action: "planning_semaine_regeneree", userId: "dir" }));
    // Une seconde régénération n'ajoute plus rien.
    const encore = await genererSemaine(db as any, ORG, { lundi: LUNDI, regenerer: true, userId: "dir" });
    expect(encore.services[0]!.creees).toBe(0);
  });
});

describe("modification manuelle d'une semaine générée (point d'entrée unique)", () => {
  it("renseigne modifie_at une seule fois, seulement tant que la semaine n'est pas publiée", async () => {
    const db = base();
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    adminCourant = db;
    await noterModificationPlanning(ORG, [{ serviceId: S1, startAt: at("2026-11-11", "07:00") }]);
    const premiere = suivi(db)[0]!.modifie_at;
    expect(premiere).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    await noterModificationPlanning(ORG, [{ serviceId: S1, jour: "2026-11-12" }, { serviceId: S1, jour: "2026-11-13" }]);
    expect(suivi(db)[0]!.modifie_at).toBe(premiere);
    // Autre semaine, autre service : sans effet.
    await noterModificationPlanning(ORG, [{ serviceId: S1, jour: "2026-11-17" }, { serviceId: "autre", jour: "2026-11-12" }]);
    expect(suivi(db)).toHaveLength(1);
  });

  it("semaine publiée : plus de modification notée ; table absente : jamais d'erreur", async () => {
    const db = base();
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    suivi(db)[0]!.publie_at = "2026-11-06T16:00:00Z";
    adminCourant = db;
    await noterModificationPlanning(ORG, [{ serviceId: S1, jour: "2026-11-12" }]);
    expect(suivi(db)[0]!.modifie_at).toBeNull();
    adminCourant = fakeDb({});
    await expect(noterModificationPlanning(ORG, [{ serviceId: S1, jour: "2026-11-12" }])).resolves.toBeUndefined();
    adminCourant = null;
    await expect(noterModificationPlanning(ORG, [{ serviceId: S1, jour: "2026-11-12" }])).resolves.toBeUndefined();
  });
});

describe("semaines masquées aux chauffeurs (crons de rappel et de résumé)", () => {
  it("masquées : générées et pas publiées ; table absente : aucune", async () => {
    const db = base();
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    const m = await semainesMasqueesDe(db as any, ORG);
    expect(estMasquee(m, { service_id: S1, start_at: at("2026-11-12", "07:00") })).toBe(true);
    suivi(db)[0]!.publie_at = "2026-11-06T16:00:00Z";
    expect((await semainesMasqueesDe(db as any, ORG)).size).toBe(0);
    expect((await semainesMasqueesDe(fakeDb({}) as any, ORG)).size).toBe(0);
  });
});

describe("envoyerSemainesAuto : le vendredi à 17 h (heure de Paris)", () => {
  const VENDREDI_HIVER_17H30 = new Date("2026-11-06T16:30:00Z");

  async function generee() {
    const db = base();
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    return db;
  }

  it("non modifiée : publication automatique, chauffeurs prévenus, semaine visible, alertes clôturées et envoi tracé", async () => {
    const db = await generee();
    const bilan = await envoyerSemainesAuto(db as any, ORG, VENDREDI_HIVER_17H30);
    expect(bilan).toMatchObject({ envoyees: 1, rappels: 0, erreurs: [] });
    expect(suivi(db)[0]).toMatchObject({ publie_mode: "auto", confirme_at: null });
    expect(suivi(db)[0]!.publie_at).not.toBeNull();
    expect(db.ligne("planning_validations")).toHaveLength(1);
    expect(db.ligne("planning_validations")[0]).toMatchObject({ service_id: S1, week_start: LUNDI, validated_by: "dir" });
    // Une notification par chauffeur concerné, avec le récapitulatif.
    const chauffeurs = db.ligne("alerts").filter((a) => a.type === "planning_validated");
    expect(chauffeurs.map((a) => a.recipient_user_id).sort()).toEqual(["d1", "d2"]);
    expect(chauffeurs.find((a) => a.recipient_user_id === "d1")!.message).toContain("n°12");
    // Génération clôturée, information d'envoi à l'encadrement.
    expect(db.ligne("alerts").find((a) => a.cle_dedoublonnage === `planning:a_confirmer:${S1}:${LUNDI}`)!.status).toBe("resolved");
    const envoi = db.ligne("alerts").find((a) => a.cle_dedoublonnage === `planning:envoye:${S1}:${LUNDI}`)!;
    expect(envoi).toMatchObject({ type: "planning_a_confirmer", severity: "info", recipient_roles: ["manager", "exploitation", "direction"], service_id: S1 });
    expect(envoi.message).toContain("Planning envoyé automatiquement aux chauffeurs");
    expect(journal).toHaveBeenLastCalledWith(expect.objectContaining({ action: "planning_semaine_envoyee_auto", userId: null }));
    expect(estMasquee(await semainesMasqueesDe(db as any, ORG), { service_id: S1, start_at: at("2026-11-12", "07:00") })).toBe(false);
  });

  it("idempotent : le second passage (autre créneau du cron) ne renvoie rien", async () => {
    const db = await generee();
    await envoyerSemainesAuto(db as any, ORG, VENDREDI_HIVER_17H30);
    const notifications = db.ligne("alerts").length;
    const seconde = await envoyerSemainesAuto(db as any, ORG, new Date("2026-11-06T16:50:00Z"));
    expect(seconde).toMatchObject({ envoyees: 0, rappels: 0 });
    expect(db.ligne("alerts")).toHaveLength(notifications);
    expect(db.ligne("planning_validations")).toHaveLength(1);
  });

  it("avant 17 h à Paris (premier passage d'hiver, 16 h Paris) : rien", async () => {
    const db = await generee();
    const bilan = await envoyerSemainesAuto(db as any, ORG, new Date("2026-11-06T15:05:00Z"));
    expect(bilan).toMatchObject({ envoyees: 0, rappels: 0, attente: "avant_17h" });
    expect(suivi(db)[0]!.publie_at).toBeNull();
    expect(db.ligne("planning_validations")).toHaveLength(0);
  });

  it("été : le passage de 15 h UTC (17 h Paris) envoie, celui de 16 h UTC ne renvoie rien", async () => {
    const db = base({
      planning_entries: base().ligne("planning_entries").map((e) => ({ ...e })),
    });
    // Semaine d'été : on déplace tout un cran, cf. dates du test (juin 2026).
    const ete = fakeDb({ ...db.tables, planning_entries: [{ id: "j1", organization_id: ORG, service_id: S1, tour_number: "12", driver_id: "d1", vehicle_id: "v1", start_at: at("2026-06-01", "07:00"), status: "planned", tour_open: true }] });
    await genererSemaine(ete as any, ORG, { lundi: "2026-06-08" });
    expect(await envoyerSemainesAuto(ete as any, ORG, new Date("2026-06-05T15:00:30Z"))).toMatchObject({ envoyees: 1 });
    expect(await envoyerSemainesAuto(ete as any, ORG, new Date("2026-06-05T16:00:30Z"))).toMatchObject({ envoyees: 0, rappels: 0 });
  });

  it("modifiée mais pas confirmée : pas d'envoi, rappel critique une seule fois, reste à traiter", async () => {
    const db = await generee();
    suivi(db)[0]!.modifie_at = "2026-11-05T09:00:00Z";
    const bilan = await envoyerSemainesAuto(db as any, ORG, VENDREDI_HIVER_17H30);
    expect(bilan).toMatchObject({ envoyees: 0, rappels: 1 });
    expect(db.ligne("planning_validations")).toHaveLength(0);
    expect(suivi(db)[0]!.publie_at).toBeNull();
    const rappel = db.ligne("alerts").find((a) => a.cle_dedoublonnage === `planning:rappel:${S1}:${LUNDI}`)!;
    expect(rappel).toMatchObject({ severity: "critical", type: "planning_a_confirmer", status: "open" });
    expect(rappel.message).toContain("Planning modifié mais pas envoyé : confirmez maintenant");
    expect(suivi(db)[0]!.rappel_envoye_at).not.toBeNull();
    // Second passage : aucun nouveau rappel.
    expect(await envoyerSemainesAuto(db as any, ORG, new Date("2026-11-06T16:55:00Z"))).toMatchObject({ rappels: 0, envoyees: 0 });
    expect(db.ligne("alerts").filter((a) => a.cle_dedoublonnage === `planning:rappel:${S1}:${LUNDI}`)).toHaveLength(1);
  });

  it("déjà confirmée ou publiée : rien", async () => {
    const db = await generee();
    suivi(db)[0]!.publie_at = "2026-11-06T10:00:00Z";
    expect(await envoyerSemainesAuto(db as any, ORG, VENDREDI_HIVER_17H30)).toMatchObject({ envoyees: 0, rappels: 0 });
    expect(db.ligne("planning_validations")).toHaveLength(0);
  });

  it("sans la migration : aucune erreur", async () => {
    const db = fakeDb({ services: [], planning_entries: [] });
    expect(await envoyerSemainesAuto(db as any, ORG, VENDREDI_HIVER_17H30)).toMatchObject({ migrationManquante: true, envoyees: 0 });
  });
});

describe("confirmerSemaine : « Confirmer et envoyer aux chauffeurs »", () => {
  const ligneDe = (db: FakeDb) => suivi(db)[0] as unknown as LigneSuivi;

  it("publie immédiatement, prévient les chauffeurs, clôt les alertes et trace la confirmation", async () => {
    const db = base();
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    const r = await confirmerSemaine({ db: db as any, admin: db as any, organizationId: ORG, userId: "dir", ligne: ligneDe(db), envoyerQuandMeme: false });
    expect(r).toEqual({ ok: true, sent: 2, casesARemplacer: 0 });
    expect(suivi(db)[0]).toMatchObject({ publie_mode: "manuel", confirme_par: "dir" });
    expect(suivi(db)[0]!.confirme_at).not.toBeNull();
    expect(db.ligne("alerts").filter((a) => a.type === "planning_validated")).toHaveLength(2);
    expect(db.ligne("alerts").find((a) => a.type === "planning_a_confirmer")!.status).toBe("resolved");
    expect(journal).toHaveBeenLastCalledWith(expect.objectContaining({ action: "planning_semaine_confirmee", userId: "dir" }));
    // Seconde confirmation : refusée, rien n'est renvoyé.
    const encore = await confirmerSemaine({ db: db as any, admin: db as any, organizationId: ORG, userId: "dir", ligne: ligneDe(db), envoyerQuandMeme: false });
    expect(encore).toMatchObject({ ok: false, status: 409, code: "deja_publiee" });
    expect(db.ligne("alerts").filter((a) => a.type === "planning_validated")).toHaveLength(2);
  });

  it("cases à remplacer : refusée, sauf « Envoyer quand même »", async () => {
    const db = base({ leave_requests: [{ organization_id: ORG, driver_id: "d1", start_date: "2026-11-09", end_date: "2026-11-10", status: "approved" }] });
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    const refus = await confirmerSemaine({ db: db as any, admin: db as any, organizationId: ORG, userId: "dir", ligne: ligneDe(db), envoyerQuandMeme: false });
    expect(refus).toMatchObject({ ok: false, status: 409, code: "cases_a_remplacer", casesARemplacer: 2 });
    expect(suivi(db)[0]!.publie_at).toBeNull();
    expect(db.ligne("planning_validations")).toHaveLength(0);
    const ok = await confirmerSemaine({ db: db as any, admin: db as any, organizationId: ORG, userId: "dir", ligne: ligneDe(db), envoyerQuandMeme: true });
    expect(ok).toMatchObject({ ok: true, casesARemplacer: 2 });
    expect(journal).toHaveBeenLastCalledWith(expect.objectContaining({ details: expect.objectContaining({ envoye_quand_meme: true, cases_a_remplacer: 2 }) }));
  });
});

describe("lecture du planning", () => {
  it("par pages, sans les présences du bureau", async () => {
    const db = base({ planning_entries: [{ id: "p", organization_id: ORG, service_id: S1, tour_number: "PRESENCE-1", driver_id: "d1", start_at: at("2026-11-02", "08:00"), status: "presence" }, ...base().ligne("planning_entries")] });
    const lignes = await lireLignesPlanning(db as any, ORG, at("2026-11-02", "00:00"), at("2026-11-09", "00:00"));
    expect(lignes).toHaveLength(3);
  });
});
