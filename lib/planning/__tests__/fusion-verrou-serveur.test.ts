import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const journal = vi.fn();
vi.mock("@/lib/audit/journal", () => ({ journaliser: (p: unknown) => journal(p) }));
let adminCourant: unknown = null;
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => adminCourant }));

import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { cloreAlertesFusion, doublonsDeLaFusion, doublonsDeLaSemaine, lireOriginesFusion, lireVerrous, marquerFusionneesAujourdhuiDemain, synchroniserAlertesFusion, verrousDeLaPeriode } from "@/lib/planning/fusion-verrou-serveur";
import { cleAlerteFusion } from "@/lib/planning/fusion-verrou";
import { confirmerSemaine, envoyerSemainesAuto, genererSemaine } from "@/lib/planning/semaines-auto-serveur";
import type { LigneSuivi } from "@/lib/planning/semaines-auto";
import { fakeDb, type FakeDb } from "./_fake-db";

const at = (date: string, heure: string) => parisWallTimeToUtcISOString(date, heure);
const ORG = "o1";
const S1 = "s1";
const LUNDI = "2026-11-09";

const entree = (id: string, tour: string, driver: string | null, jour: string, heure = "07:00", p: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  service_id: S1,
  tour_number: tour,
  driver_id: driver,
  vehicle_id: driver ? "v1" : null,
  start_at: at(jour, heure),
  status: "planned",
  tour_open: true,
  ...p,
});

/** Lundi 9 novembre : la n°106 (hôte) regroupe la n°105, qui est encore affectée à Dupont (doublon). */
function planningAvecFusion(extra: Record<string, any[]> = {}) {
  return fakeDb({
    planning_entries: [entree("h106", "106", "d2", LUNDI), entree("x105", "105", "d1", LUNDI, "06:30"), entree("y105", "105", "d1", "2026-11-10", "06:30"), entree("z107", "107", null, LUNDI, "08:00")],
    planning_entry_merged_routes: [{ id: "m1", organization_id: ORG, planning_entry_id: "h106", route_id: "r105" }],
    tour_routes: [
      { id: "r105", organization_id: ORG, tour_number: "105" },
      { id: "r106", organization_id: ORG, tour_number: "106" },
    ],
    users: [
      { id: "d1", organization_id: ORG, full_name: "Dupont", active: true },
      { id: "d2", organization_id: ORG, full_name: "Martin", active: true },
    ],
    alerts: [],
    ...extra,
  });
}

beforeEach(() => {
  journal.mockReset();
  adminCourant = null;
});

describe("lectures de cases verrouillées", () => {
  it("origines d'une fusion : numéros des tournées, lignes non fusionnées absentes", async () => {
    const db = planningAvecFusion();
    expect(await lireOriginesFusion(db as any, ORG, ["h106", "x105"])).toEqual([{ entryId: "h106", tournees: ["105"] }]);
    expect(await lireOriginesFusion(db as any, ORG, [])).toEqual([]);
    // Autre organisation : rien.
    expect(await lireOriginesFusion(db as any, "autre", ["h106"])).toEqual([]);
  });

  it("verrous de la période : la 105 du lundi, pas celle du mardi", async () => {
    const db = planningAvecFusion();
    const { verrous, entrees } = await verrousDeLaPeriode(db as any, ORG, S1, LUNDI, "2026-11-10");
    expect([...verrous.keys()]).toEqual([`${S1}|105@${LUNDI}`]);
    expect(entrees).toHaveLength(4);
    expect((await lireVerrous(db as any, ORG, entrees)).size).toBe(1);
    // Un autre service ne voit pas la fusion.
    expect((await verrousDeLaPeriode(db as any, ORG, "s2", LUNDI, LUNDI)).verrous.size).toBe(0);
  });

  it("tolérant : sans les tables de fusion (migration pas appliquée), aucune tournée n'est verrouillée et rien ne casse", async () => {
    const db = fakeDb({ planning_entries: [entree("h106", "106", "d2", LUNDI)] });
    expect(await lireOriginesFusion(db as any, ORG, ["h106"])).toEqual([]);
    const { verrous, entrees } = await verrousDeLaPeriode(db as any, ORG, S1, LUNDI, LUNDI);
    expect(verrous.size).toBe(0);
    expect(entrees).toHaveLength(1);
    expect(await doublonsDeLaSemaine(db as any, ORG, S1, LUNDI)).toEqual([]);
    expect(await doublonsDeLaFusion(db as any, ORG, { id: "h106", service_id: S1, tour_number: "106", start_at: at(LUNDI, "07:00"), status: "planned" }, [])).toEqual([]);
  });

  it("table de planning absente : aucune ligne, aucune erreur", async () => {
    const db = fakeDb({});
    expect(await verrousDeLaPeriode(db as any, ORG, S1, LUNDI, LUNDI)).toEqual({ entrees: [], verrous: new Map() });
  });

  it("lignes d'aujourd'hui et de demain marquées « fusionnée » (hôte de tout statut)", async () => {
    // Lundi 9 novembre 2026, 9 h à Paris ; l'hôte est déjà en cours : sa tournée d'origine reste verrouillée.
    const db = planningAvecFusion({ planning_entries: [entree("h106", "106", "d2", LUNDI, "06:00", { status: "in_progress" }), entree("x105", "105", null, LUNDI, "06:30")] });
    const lignes = await marquerFusionneesAujourdhuiDemain(db as any, ORG, [{ id: "x105", service_id: S1, tour_number: "105", start_at: at(LUNDI, "06:30") }], new Date("2026-11-09T08:00:00Z"));
    expect(lignes[0]!.fusionnee).toBe(true);
  });
});

describe("doublons", () => {
  it("fusion marquée alors que la 105 est déjà affectée : doublon nommé, message prêt à afficher", async () => {
    const db = planningAvecFusion();
    const d = await doublonsDeLaFusion(db as any, ORG, { id: "h106", service_id: S1, tour_number: "106", start_at: at(LUNDI, "07:00"), status: "planned" }, ["105"]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ entry_id: "x105", tour_number: "105", chauffeur: "Dupont", hote: "106", status: "planned" });
    expect(d[0]!.message).toBe("La tournée n°105 est déjà affectée à Dupont : retirez-le ou conservez la tournée séparée (fusion avec la n°106).");
  });

  it("sans affectation sur la tournée d'origine : aucun doublon", async () => {
    const db = planningAvecFusion({ planning_entries: [entree("h106", "106", "d2", LUNDI), entree("x105", "105", null, LUNDI)] });
    expect(await doublonsDeLaFusion(db as any, ORG, { id: "h106", service_id: S1, tour_number: "106", start_at: at(LUNDI, "07:00"), status: "planned" }, ["105"])).toEqual([]);
  });

  it("doublons d'une semaine (bloquent l'envoi du vendredi) : ceux du service et de la semaine seulement", async () => {
    const db = planningAvecFusion();
    const d = await doublonsDeLaSemaine(db as any, ORG, S1, LUNDI);
    expect(d.map((x) => x.entryId)).toEqual(["x105"]);
    expect(await doublonsDeLaSemaine(db as any, ORG, S1, "2026-11-16")).toEqual([]);
    expect(await doublonsDeLaSemaine(db as any, ORG, "s2", LUNDI)).toEqual([]);
  });
});

describe("alertes d'encadrement de fusion", () => {
  const hote = { id: "h106", service_id: S1, tour_number: "106", start_at: at(LUNDI, "07:00") };
  const alertes = (db: FakeDb) => db.ligne("alerts").filter((a) => a.type === "planning_fusion");

  it("une alerte par fusion et par jour : message, destinataires par rôle, service, clé de dédoublonnage", async () => {
    const db = planningAvecFusion();
    const b = await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["105"] });
    expect(b).toMatchObject({ creee: true, closes: 0, typeAbsent: false });
    expect(alertes(db)).toHaveLength(1);
    expect(alertes(db)[0]).toMatchObject({
      organization_id: ORG,
      type: "planning_fusion",
      severity: "info",
      message: "Tournée n°105 fusionnée avec la n°106 le lundi 9 novembre",
      related_table: "planning_entries",
      related_id: "h106",
      recipient_roles: ["manager", "exploitation", "direction"],
      service_id: S1,
      cle_dedoublonnage: cleAlerteFusion("h106", ["105"]),
      status: "open",
    });
    // Jamais de destinataire nommé (ni chauffeur ni comptable) : encadrement seulement.
    expect(alertes(db)[0]!.recipient_user_id).toBeUndefined();
    expect(alertes(db)[0]!.recipient_roles).not.toContain("chauffeur");
    expect(alertes(db)[0]!.recipient_roles).not.toContain("comptable");
  });

  it("dédoublonnée : enregistrer deux fois la même fusion ne crée qu'une alerte", async () => {
    const db = planningAvecFusion();
    await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["105"] });
    const seconde = await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["105"] });
    expect(seconde.creee).toBe(false);
    expect(alertes(db)).toHaveLength(1);
  });

  it("fusion modifiée : l'ancienne alerte est close, une nouvelle annonce la nouvelle liste", async () => {
    const db = planningAvecFusion();
    await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["105"] });
    const b = await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["105", "107"] });
    expect(b).toMatchObject({ creee: true, closes: 1 });
    expect(alertes(db).map((a) => [a.status, a.message])).toEqual([
      ["resolved", "Tournée n°105 fusionnée avec la n°106 le lundi 9 novembre"],
      ["open", "Tournées n°105 et n°107 fusionnées avec la n°106 le lundi 9 novembre"],
    ]);
  });

  it("fusion retirée : alertes closes, aucune nouvelle ; remise à l'identique : l'alerte est rouverte sans doublon", async () => {
    const db = planningAvecFusion();
    await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["105"] });
    const retrait = await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: [] });
    expect(retrait).toMatchObject({ creee: false, closes: 1 });
    expect(alertes(db)).toHaveLength(1);
    expect(alertes(db)[0]!.status).toBe("resolved");
    const retour = await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["105"] });
    expect(retour.creee).toBe(true);
    expect(alertes(db)).toHaveLength(1);
    expect(alertes(db)[0]!.status).toBe("open");
  });

  it("la tournée hôte listée parmi ses origines n'annonce rien", async () => {
    const db = planningAvecFusion();
    expect((await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["106"] })).creee).toBe(false);
    expect(alertes(db)).toHaveLength(0);
  });

  it("ne touche ni aux autres lignes hôtes ni aux autres types d'alerte", async () => {
    const db = planningAvecFusion({
      alerts: [
        { id: "autre-fusion", organization_id: ORG, type: "planning_fusion", related_id: "h999", status: "open", cle_dedoublonnage: "planning:fusion:h999:105" },
        { id: "conf", organization_id: ORG, type: "planning_a_confirmer", related_id: "h106", status: "open", cle_dedoublonnage: "planning:a_confirmer:s1:2026-11-09" },
      ],
    });
    await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: [] });
    expect(db.ligne("alerts").map((a) => [a.id, a.status])).toEqual([
      ["autre-fusion", "open"],
      ["conf", "open"],
    ]);
  });

  it("clôture à la suppression de la ligne hôte", async () => {
    const db = planningAvecFusion();
    await synchroniserAlertesFusion(db as any, { organizationId: ORG, hote, origines: ["105"] });
    expect(await cloreAlertesFusion(db as any, ORG, "h106")).toEqual({ closes: 1, typeAbsent: false });
    expect(alertes(db)[0]!.status).toBe("resolved");
  });

  it("sans la migration d'enum : aucune alerte, aucune erreur", async () => {
    const q: any = {};
    for (const m of ["select", "eq", "in", "limit", "update", "insert"]) q[m] = () => q;
    q.then = (f: any) => Promise.resolve({ data: null, error: { code: "22P02", message: 'invalid input value for enum alert_type: "planning_fusion"' } }).then(f);
    const enumAbsent = { from: () => q };
    expect(await synchroniserAlertesFusion(enumAbsent as any, { organizationId: ORG, hote, origines: ["105"] })).toMatchObject({ creee: false, typeAbsent: true });
  });
});

describe("génération de la semaine suivante avec une fusion", () => {
  const source = (id: string, tour: string, driver: string, jour: string) => entree(id, tour, driver, jour);
  function base(extra: Record<string, any[]> = {}) {
    return fakeDb({
      services: [{ id: S1, organization_id: ORG, name: "Colis", pole: null }],
      users: [
        { id: "d1", organization_id: ORG, full_name: "Dupont", active: true, role: "chauffeur" },
        { id: "d2", organization_id: ORG, full_name: "Martin", active: true, role: "chauffeur" },
        { id: "dir", organization_id: ORG, full_name: "Direction", active: true, role: "direction", created_at: "2025-01-01" },
      ],
      employee_files: [],
      leave_requests: [],
      work_stoppages: [],
      planning_entries: [source("a1", "12", "d1", "2026-11-02"), source("a2", "14", "d2", "2026-11-02"), source("a3", "14", "d2", "2026-11-03")],
      planning_tour_templates: [],
      planning_validations: [],
      planning_semaines_auto: [],
      alerts: [],
      ...extra,
    });
  }
  const cible = (db: FakeDb) => db.ligne("planning_entries").filter((e) => e.start_at >= at(LUNDI, "00:00") && e.start_at < at("2026-11-16", "00:00"));

  it("la tournée d'origine fusionnée la semaine cible n'est pas recopiée, les autres jours le sont ; le résumé le dit", async () => {
    // Le lundi 9, la n°12 (hôte) regroupe la n°14 : la 14 du lundi n'est pas créée.
    const db = base({
      planning_entries: [source("a1", "12", "d1", "2026-11-02"), source("a2", "14", "d2", "2026-11-02"), source("a3", "14", "d2", "2026-11-03"), entree("h12", "12", "d1", LUNDI)],
      planning_entry_merged_routes: [{ id: "m1", organization_id: ORG, planning_entry_id: "h12", route_id: "r14" }],
      tour_routes: [{ id: "r14", organization_id: ORG, tour_number: "14" }],
    });
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services[0]).toMatchObject({ statut: "generee" });
    expect(bilan.services[0]!.resume!.fusionnees).toBe(1);
    expect(cible(db).map((e) => [e.tour_number, e.start_at.slice(0, 10)]).sort()).toEqual([
      ["12", at(LUNDI, "07:00").slice(0, 10)],
      ["14", at("2026-11-10", "07:00").slice(0, 10)],
    ]);
    expect(db.ligne("planning_semaines_auto")[0]!.resume.fusionnees).toBe(1);
    expect(journal).toHaveBeenCalledWith(expect.objectContaining({ action: "planning_semaine_generee", details: expect.objectContaining({ fusionnees: 1 }) }));
  });

  it("une tournée d'origine fusionnée la semaine source (doublon) n'est pas recopiée comme une affectation", async () => {
    const db = base({
      planning_entries: [entree("h12", "12", "d1", "2026-11-02"), source("a2", "14", "d2", "2026-11-02"), source("a3", "14", "d2", "2026-11-03")],
      planning_entry_merged_routes: [{ id: "m1", organization_id: ORG, planning_entry_id: "h12", route_id: "r14" }],
      tour_routes: [{ id: "r14", organization_id: ORG, tour_number: "14" }],
    });
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(cible(db).map((e) => `${e.tour_number}@${e.start_at.slice(0, 10)}`).sort()).toEqual(["12@" + at(LUNDI, "07:00").slice(0, 10), "14@" + at("2026-11-10", "07:00").slice(0, 10)]);
  });

  it("sans les tables de fusion : génération identique à avant", async () => {
    const db = base();
    const bilan = await genererSemaine(db as any, ORG, { lundi: LUNDI });
    expect(bilan.services[0]!.resume!.fusionnees).toBe(0);
    expect(cible(db)).toHaveLength(3);
  });
});

describe("envoi automatique du vendredi avec un doublon de fusion", () => {
  const VENDREDI_17H30 = new Date("2026-11-06T16:30:00Z");

  async function semaineGeneree(avecDoublon: boolean) {
    const db = fakeDb({
      services: [{ id: S1, organization_id: ORG, name: "Colis", pole: null }],
      users: [
        { id: "d1", organization_id: ORG, full_name: "Dupont", active: true, role: "chauffeur" },
        { id: "d2", organization_id: ORG, full_name: "Martin", active: true, role: "chauffeur" },
        { id: "dir", organization_id: ORG, full_name: "Direction", active: true, role: "direction", created_at: "2025-01-01" },
      ],
      employee_files: [],
      leave_requests: [],
      work_stoppages: [],
      planning_entries: [entree("a1", "106", "d1", "2026-11-02"), entree("a3", "105", "d2", "2026-11-02")],
      planning_tour_templates: [],
      planning_validations: [],
      planning_semaines_auto: [],
      planning_entry_merged_routes: [],
      tour_routes: [{ id: "r105", organization_id: ORG, tour_number: "105" }],
      alerts: [],
    });
    await genererSemaine(db as any, ORG, { lundi: LUNDI });
    const hote = db.ligne("planning_entries").find((e) => e.tour_number === "106" && e.start_at >= at(LUNDI, "00:00"))!;
    // Le lundi 9, la 106 regroupe la 105 — qui a été recopiée avec son chauffeur : doublon.
    if (avecDoublon) db.ligne("planning_entry_merged_routes").push({ id: "m1", organization_id: ORG, planning_entry_id: hote.id, route_id: "r105" });
    return db;
  }

  it("doublon : aucun envoi, un rappel critique à l'encadrement (une seule fois), les chauffeurs ne sont pas prévenus", async () => {
    const db = await semaineGeneree(true);
    const bilan = await envoyerSemainesAuto(db as any, ORG, VENDREDI_17H30);
    expect(bilan).toMatchObject({ envoyees: 0, rappels: 1, erreurs: [] });
    expect(db.ligne("planning_validations")).toHaveLength(0);
    expect(db.ligne("planning_semaines_auto")[0]!.publie_at).toBeNull();
    const rappel = db.ligne("alerts").find((a) => a.cle_dedoublonnage === `planning:rappel:${S1}:${LUNDI}`)!;
    expect(rappel).toMatchObject({ type: "planning_a_confirmer", severity: "critical", status: "open", recipient_roles: ["manager", "exploitation", "direction"] });
    expect(rappel.message).toContain("1 doublon de tournée fusionnée");
    expect(db.ligne("alerts").filter((a) => a.type === "planning_validated")).toHaveLength(0);
    expect(journal).toHaveBeenLastCalledWith(expect.objectContaining({ action: "planning_semaine_rappel", details: expect.objectContaining({ doublons_fusion: 1 }) }));
    // Second passage du cron : pas de second rappel.
    expect(await envoyerSemainesAuto(db as any, ORG, new Date("2026-11-06T16:55:00Z"))).toMatchObject({ rappels: 0, envoyees: 0 });
    expect(db.ligne("alerts").filter((a) => a.cle_dedoublonnage === `planning:rappel:${S1}:${LUNDI}`)).toHaveLength(1);
  });

  it("doublon retiré avant le vendredi : la semaine intacte part toute seule, comme avant", async () => {
    const db = await semaineGeneree(true);
    // Retrait de l'affectation de la 105 (route « Retirer l'affectation »).
    const i = db.ligne("planning_entries").findIndex((e) => e.tour_number === "105" && e.start_at >= at(LUNDI, "00:00"));
    db.ligne("planning_entries").splice(i, 1);
    // Une suppression à la main ne modifie pas le suivi ici : la semaine est intacte.
    const bilan = await envoyerSemainesAuto(db as any, ORG, VENDREDI_17H30);
    expect(bilan).toMatchObject({ envoyees: 1, rappels: 0 });
  });

  it("sans fusion : envoi automatique inchangé", async () => {
    const db = await semaineGeneree(false);
    expect(await envoyerSemainesAuto(db as any, ORG, VENDREDI_17H30)).toMatchObject({ envoyees: 1, rappels: 0 });
  });

  it("la confirmation manuelle ne compte pas une tournée fusionnée comme case à remplacer", async () => {
    const db = await semaineGeneree(true);
    // La 105 du lundi est recopiée avec son chauffeur ; on la vide : sans la fusion elle serait « à remplacer ».
    const x = db.ligne("planning_entries").find((e) => e.tour_number === "105" && e.start_at >= at(LUNDI, "00:00"))!;
    x.driver_id = null;
    const ligne = db.ligne("planning_semaines_auto")[0] as unknown as LigneSuivi;
    const r = await confirmerSemaine({ db: db as any, admin: db as any, organizationId: ORG, userId: "dir", ligne, envoyerQuandMeme: false });
    expect(r).toMatchObject({ ok: true, casesARemplacer: 0 });
  });
});
