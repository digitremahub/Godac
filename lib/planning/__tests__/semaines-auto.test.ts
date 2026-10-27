import { describe, expect, it } from "vitest";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { estAbsentOuInactif, type ContexteAbsences } from "@/lib/planning/semaines-auto-absences";
import { construireBandeau, semaineAPreparer } from "@/lib/planning/bandeau-semaine";
import type { AffectationPlanning } from "@/lib/planning/semaine";
import {
  MESSAGE_SANS_SOURCE,
  PUBLICATION_AUTO_SI_MODIFIE,
  SEMAINES_A_L_AVANCE,
  casesSansChauffeur,
  choisirSemaineSource,
  envoiAutomatiquePrevu,
  estSemainePreparable,
  lundisAvecAffectations,
  semainesPreparables,
  cleAlerteGeneration,
  compterConflitsVehicule,
  cumulerResumes,
  decisionEnvoiAuto,
  estMasquee,
  estUrgentLeVendredi,
  etatSemaine,
  generationDuJour,
  instantParis,
  libelleAbsent,
  libelleSemaine,
  lireResume,
  messageAbsenceApparue,
  messageGeneration,
  nombreSemainesIso,
  numeroSemaineIso,
  planifierSemaineSuivante,
  resumeVide,
  semaineSuivante,
  semainesMasquees,
  servicesPublieesRecemment,
  titreGeneration,
  verdictConfirmation,
  type LigneSuivi,
  type ModeleGeneration,
} from "@/lib/planning/semaines-auto";

const at = (date: string, heure: string) => parisWallTimeToUtcISOString(date, heure);
const aff = (p: Partial<AffectationPlanning> & { id: string }): AffectationPlanning => ({ service_id: "s1", tour_number: "12", driver_id: "d1", vehicle_id: "v1", start_at: at("2026-11-02", "07:00"), status: "planned", ...p });
const vide: ContexteAbsences = { conges: [], arrets: [], inactifs: new Set(), sorties: new Map() };
const nomDe = (id: string) => ({ d1: "Dupont", d2: "Martin", d3: "Bernard" })[id] ?? "Chauffeur";

describe("calendrier : du jeudi à la semaine suivante", () => {
  it("jeudi 5 novembre 2026 → lundi 9 au dimanche 15 novembre", () => {
    expect(semaineSuivante("2026-11-05")).toEqual({ lundiSource: "2026-11-02", lundi: "2026-11-09", dimanche: "2026-11-15" });
    // N'importe quel jour de la semaine en cours donne la même semaine suivante.
    expect(semaineSuivante("2026-11-02").lundi).toBe("2026-11-09");
    expect(semaineSuivante("2026-11-08").lundi).toBe("2026-11-09");
  });

  it("le cron du jeudi n'agit que le jeudi de Paris, été comme hiver", () => {
    // 4 h UTC : 5 h en hiver, 6 h en été (heure de Paris).
    expect(generationDuJour(new Date("2026-11-05T04:00:00Z"))).toEqual({ ok: true, semaine: semaineSuivante("2026-11-05") });
    expect(generationDuJour(new Date("2026-07-09T04:00:00Z"))).toMatchObject({ ok: true });
    expect(generationDuJour(new Date("2026-11-06T04:00:00Z"))).toMatchObject({ ok: false });
    // Mercredi 23 h UTC = jeudi 0 h ou 1 h à Paris.
    expect(generationDuJour(new Date("2026-11-04T23:30:00Z"))).toMatchObject({ ok: true });
  });

  it("passage à l'heure d'hiver : jeudi 22 octobre → lundi 26 octobre (semaine de 7 jours, 25 h le dimanche)", () => {
    expect(semaineSuivante("2026-10-22")).toEqual({ lundiSource: "2026-10-19", lundi: "2026-10-26", dimanche: "2026-11-01" });
    expect(instantParis(new Date("2026-10-25T23:30:00Z"))).toMatchObject({ jour: "2026-10-26", heure: 0, rang: 0 });
  });

  it("passage à l'heure d'été : jeudi 26 mars 2026 → lundi 30 mars", () => {
    expect(semaineSuivante("2026-03-26").lundi).toBe("2026-03-30");
    expect(instantParis(new Date("2026-03-28T23:30:00Z"))).toMatchObject({ jour: "2026-03-29", heure: 0, rang: 6 });
  });

  it("52 ou 53 semaines : fin 2026 (53 semaines) et début 2027", () => {
    expect(nombreSemainesIso(2026)).toBe(53);
    expect(nombreSemainesIso(2025)).toBe(52);
    expect(nombreSemainesIso(2027)).toBe(52);
    expect(nombreSemainesIso(2020)).toBe(53);
    // Jeudi 24 décembre 2026 → semaine 53 ; jeudi 31 décembre → semaine 1 de 2027.
    expect(semaineSuivante("2026-12-24").lundi).toBe("2026-12-28");
    expect(numeroSemaineIso("2026-12-28")).toBe(53);
    expect(semaineSuivante("2026-12-31").lundi).toBe("2027-01-04");
    expect(numeroSemaineIso("2027-01-04")).toBe(1);
    expect(numeroSemaineIso("2026-11-09")).toBe(46);
  });

  it("libellés : même mois, deux mois, deux années", () => {
    expect(libelleSemaine("2026-11-09")).toBe("du lundi 9 au dimanche 15 novembre");
    expect(libelleSemaine("2026-10-26")).toBe("du lundi 26 octobre au dimanche 1er novembre");
    expect(libelleSemaine("2026-12-28")).toBe("du lundi 28 décembre 2026 au dimanche 3 janvier 2027");
    expect(titreGeneration("2026-11-09")).toBe("Planning du lundi 9 au dimanche 15 novembre généré : à confirmer avant vendredi 17 h");
    expect(titreGeneration("2026-11-09", "Colis")).toBe("Planning du lundi 9 au dimanche 15 novembre généré : à confirmer avant vendredi 17 h — Colis");
  });

  it("urgent à partir du vendredi qui précède la semaine", () => {
    expect(estUrgentLeVendredi("2026-11-09", "2026-11-05")).toBe(false);
    expect(estUrgentLeVendredi("2026-11-09", "2026-11-06")).toBe(true);
    expect(estUrgentLeVendredi("2026-11-09", "2026-11-08")).toBe(true);
  });
});

describe("règle d'envoi du vendredi 17 h", () => {
  const ligne = { semaine_debut: "2026-11-09", modifie_at: null, confirme_at: null, publie_at: null, rappel_envoye_at: null };
  // Hiver : 17 h à Paris = 16 h UTC. Été : 17 h à Paris = 15 h UTC.
  const hiver = (h: string) => new Date(`2026-11-06T${h}Z`);

  it("PUBLICATION_AUTO_SI_MODIFIE est faux par défaut", () => {
    expect(PUBLICATION_AUTO_SI_MODIFIE).toBe(false);
  });

  it("non modifiée, vendredi 17 h passé : publication automatique", () => {
    expect(decisionEnvoiAuto({ ligne, maintenant: hiver("16:05:00") })).toEqual({ action: "publier" });
    expect(decisionEnvoiAuto({ ligne, maintenant: hiver("16:59:00") })).toEqual({ action: "publier" });
    // Le second passage (16 h UTC en été = 18 h Paris) agit aussi si le premier n'a rien fait.
    expect(decisionEnvoiAuto({ ligne, maintenant: new Date("2026-06-05T15:10:00Z"), publierSiModifie: false })).toMatchObject({ action: "rien", raison: "mauvaise_semaine" });
  });

  it("avant 17 h à Paris : rien (premier passage d'hiver à 16 h Paris)", () => {
    expect(decisionEnvoiAuto({ ligne, maintenant: hiver("15:05:00") })).toEqual({ action: "rien", raison: "avant_17h" });
    expect(decisionEnvoiAuto({ ligne, maintenant: hiver("15:59:59") })).toEqual({ action: "rien", raison: "avant_17h" });
  });

  it("été : le passage de 15 h UTC est à 17 h Paris, celui de 16 h UTC à 18 h", () => {
    const ete = { ...ligne, semaine_debut: "2026-06-08" };
    expect(decisionEnvoiAuto({ ligne: ete, maintenant: new Date("2026-06-05T15:00:30Z") })).toEqual({ action: "publier" });
    expect(decisionEnvoiAuto({ ligne: ete, maintenant: new Date("2026-06-05T16:00:30Z") })).toEqual({ action: "publier" });
    expect(decisionEnvoiAuto({ ligne: ete, maintenant: new Date("2026-06-05T14:59:00Z") })).toEqual({ action: "rien", raison: "avant_17h" });
  });

  it("pas un vendredi : rien", () => {
    expect(decisionEnvoiAuto({ ligne, maintenant: new Date("2026-11-05T16:30:00Z") })).toEqual({ action: "rien", raison: "pas_vendredi" });
    expect(decisionEnvoiAuto({ ligne, maintenant: new Date("2026-11-07T16:30:00Z") })).toEqual({ action: "rien", raison: "pas_vendredi" });
  });

  it("déjà publiée ou confirmée : rien (idempotent)", () => {
    expect(decisionEnvoiAuto({ ligne: { ...ligne, publie_at: "2026-11-06T10:00:00Z" }, maintenant: hiver("16:30:00") })).toEqual({ action: "rien", raison: "deja_publiee" });
    expect(decisionEnvoiAuto({ ligne: { ...ligne, confirme_at: "2026-11-06T10:00:00Z" }, maintenant: hiver("16:30:00") })).toEqual({ action: "rien", raison: "deja_publiee" });
  });

  it("modifiée mais pas confirmée : pas d'envoi, un seul rappel", () => {
    const modifiee = { ...ligne, modifie_at: "2026-11-05T09:00:00Z" };
    expect(decisionEnvoiAuto({ ligne: modifiee, maintenant: hiver("16:30:00") })).toEqual({ action: "rappeler" });
    expect(decisionEnvoiAuto({ ligne: { ...modifiee, rappel_envoye_at: "2026-11-06T16:00:00Z" }, maintenant: hiver("16:30:00") })).toEqual({ action: "rien", raison: "rappel_deja_envoye" });
  });

  it("constante réglée sur vrai : la semaine modifiée part aussi", () => {
    expect(decisionEnvoiAuto({ ligne: { ...ligne, modifie_at: "2026-11-05T09:00:00Z" }, maintenant: hiver("16:30:00"), publierSiModifie: true })).toEqual({ action: "publier" });
  });

  it("une autre semaine que la suivante n'est pas touchée", () => {
    expect(decisionEnvoiAuto({ ligne: { ...ligne, semaine_debut: "2026-11-16" }, maintenant: hiver("16:30:00") })).toEqual({ action: "rien", raison: "mauvaise_semaine" });
  });

  it("état d'une semaine suivie", () => {
    expect(etatSemaine({ modifie_at: null, confirme_at: null, publie_at: null })).toBe("a_confirmer");
    expect(etatSemaine({ modifie_at: "x", confirme_at: null, publie_at: null })).toBe("modifiee");
    expect(etatSemaine({ modifie_at: "x", confirme_at: "y", publie_at: null })).toBe("publiee");
    expect(etatSemaine({ modifie_at: null, confirme_at: null, publie_at: "z" })).toBe("publiee");
  });
});

describe("confirmation avec des cases à remplacer", () => {
  it("refusée sans « Envoyer quand même »", () => {
    expect(verdictConfirmation({ casesARemplacer: 0 })).toEqual({ ok: true });
    expect(verdictConfirmation({ casesARemplacer: 2 })).toMatchObject({ ok: false, code: "cases_a_remplacer" });
    expect(verdictConfirmation({ casesARemplacer: 2, envoyerQuandMeme: true })).toEqual({ ok: true });
  });
});

describe("absents : congé approuvé ou demandé, arrêt, compte inactif ou sorti", () => {
  it("raison et dates du congé, « absent » sans motif pour un arrêt", () => {
    const ctx: ContexteAbsences = {
      conges: [
        { driver_id: "d1", start_date: "2026-11-12", end_date: "2026-11-14", status: "approved" },
        { driver_id: "d2", start_date: "2026-11-10", end_date: "2026-11-10", status: "pending" },
      ],
      arrets: [{ user_id: "d3", start_date: "2026-11-09", end_date: "2026-11-20", motif: "maladie" }],
      inactifs: new Set(["d4"]),
      sorties: new Map([["d5", "2026-11-10"]]),
    };
    expect(estAbsentOuInactif("d1", "2026-11-13", ctx)).toEqual({ raison: "conge", du: "2026-11-12", au: "2026-11-14" });
    expect(estAbsentOuInactif("d1", "2026-11-11", ctx)).toBeNull();
    expect(estAbsentOuInactif("d2", "2026-11-10", ctx)).toEqual({ raison: "conge_demande", du: "2026-11-10", au: "2026-11-10" });
    // Arrêt : jamais de motif ni de dates dans le résultat.
    expect(estAbsentOuInactif("d3", "2026-11-10", ctx)).toEqual({ raison: "absent", du: null, au: null });
    expect(estAbsentOuInactif("d4", "2026-11-10", ctx)).toEqual({ raison: "absent", du: null, au: null });
    expect(estAbsentOuInactif("d5", "2026-11-09", ctx)).toBeNull();
    expect(estAbsentOuInactif("d5", "2026-11-10", ctx)).toEqual({ raison: "absent", du: null, au: null });
  });

  it("libellés sans motif médical", () => {
    expect(libelleAbsent({ nom: "Dupont", raison: "conge", du: "2026-11-12", au: "2026-11-14" })).toBe("Dupont en congé du 12/11 au 14/11");
    expect(libelleAbsent({ nom: "Martin", raison: "conge_demande", du: "2026-11-10", au: "2026-11-10" })).toBe("Martin : congé demandé du 10/11 au 10/11");
    expect(libelleAbsent({ nom: "Bernard", raison: "absent", du: null, au: null })).toBe("Bernard absent");
  });
});

describe("génération de la semaine suivante d'un service", () => {
  const lundiSource = "2026-11-02";
  const lundiCible = "2026-11-09";
  const sources = [
    aff({ id: "a1", tour_number: "12", driver_id: "d1", vehicle_id: "v1" }),
    aff({ id: "a2", tour_number: "12", driver_id: "d1", vehicle_id: "v1", start_at: at("2026-11-03", "07:00") }),
    aff({ id: "a3", tour_number: "14", driver_id: "d2", vehicle_id: "v2", start_at: at("2026-11-02", "08:30") }),
  ];
  const plan = (p: Partial<Parameters<typeof planifierSemaineSuivante>[0]> = {}) =>
    planifierSemaineSuivante({ lundiSource, lundiCible, sources, existantes: [], modeles: [], contexte: vide, nomDe, ...p });

  it("recopie jour pour jour, même heure de Paris, en « prévue »", () => {
    const r = plan();
    expect(r.lignes.map((l) => [l.tour_number, l.driver_id, l.start_at])).toEqual([
      ["12", "d1", at("2026-11-09", "07:00")],
      ["12", "d1", at("2026-11-10", "07:00")],
      ["14", "d2", at("2026-11-09", "08:30")],
    ]);
    expect(r.resume).toMatchObject({ tournees: 3, chauffeurs: 2, a_remplacer: 0, fermees: 0, conflits: 0, deja_presentes: 0, absents: [] });
  });

  it("passage à l'heure d'hiver : 07:00 reste 07:00 à Paris (pas de glissement d'une heure)", () => {
    const r = planifierSemaineSuivante({
      lundiSource: "2026-10-19",
      lundiCible: "2026-10-26",
      sources: [aff({ id: "x", start_at: at("2026-10-19", "07:00") }), aff({ id: "y", tour_number: "13", start_at: at("2026-10-25", "07:00") })],
      existantes: [],
      modeles: [],
      contexte: vide,
      nomDe,
    });
    expect(r.lignes.map((l) => l.start_at)).toEqual([at("2026-10-26", "07:00"), at("2026-11-01", "07:00")]);
    // 07:00 le lundi 19 (UTC+2) = 05:00Z ; 07:00 le lundi 26 (UTC+1) = 06:00Z.
    expect(r.lignes[0]!.start_at).toBe("2026-10-26T06:00:00.000Z");
  });

  it("n'écrase rien : une case déjà présente (même tournée, même jour) est laissée telle quelle", () => {
    const existantes = [aff({ id: "e1", tour_number: "12", driver_id: "d3", vehicle_id: "v3", start_at: at("2026-11-09", "06:45") })];
    const r = plan({ existantes });
    // Lundi 9 de la tournée 12 : déjà posée à la main (autre heure, autre chauffeur) → pas de seconde ligne.
    expect(r.lignes.filter((l) => l.tour_number === "12").map((l) => l.start_at)).toEqual([at("2026-11-10", "07:00")]);
    expect(r.resume.deja_presentes).toBe(1);
    expect(r.lignes.some((l) => l.driver_id === "d3")).toBe(false);
  });

  it("deuxième passage sur la semaine déjà générée : rien de plus", () => {
    const premiere = plan();
    const existantes = premiere.lignes.map((l, i) => aff({ id: `n${i}`, tour_number: l.tour_number, driver_id: l.driver_id, vehicle_id: l.vehicle_id, start_at: l.start_at }));
    const seconde = plan({ existantes });
    expect(seconde.lignes).toEqual([]);
    expect(seconde.resume.deja_presentes).toBe(3);
  });

  it("tournées fermées : non recopiées, non comblées par un modèle, comptées", () => {
    const fermee = aff({ id: "f1", tour_number: "16", driver_id: "d3", vehicle_id: "v3", tour_open: false, start_at: at("2026-11-03", "07:00") });
    const modele: ModeleGeneration = { service_id: "s1", tour_number: "16", departure_time: "07:00:00", weekdays: [1, 2, 3, 4, 5], default_vehicle_id: null };
    const r = plan({ sources: [...sources, fermee], modeles: [modele] });
    expect(r.lignes.some((l) => l.driver_id === "d3")).toBe(false);
    // Le mardi 10 est fermé à la source : pas de ligne modèle ce jour-là, les autres jours oui.
    const jours = r.lignes.filter((l) => l.tour_number === "16").map((l) => l.start_at);
    expect(jours).not.toContain(at("2026-11-10", "07:00"));
    expect(jours).toContain(at("2026-11-09", "07:00"));
    expect(r.resume.fermees).toBe(1);
  });

  it("congé approuvé, congé demandé, arrêt, compte inactif ou sorti : case créée « à remplacer », sans motif", () => {
    const contexte: ContexteAbsences = {
      conges: [
        { driver_id: "d1", start_date: "2026-11-09", end_date: "2026-11-10", status: "approved" },
        { driver_id: "d2", start_date: "2026-11-09", end_date: "2026-11-09", status: "pending" },
      ],
      arrets: [],
      inactifs: new Set(),
      sorties: new Map(),
    };
    const r = plan({ contexte });
    expect(r.lignes.filter((l) => !l.driver_id).length).toBe(3);
    expect(r.resume.a_remplacer).toBe(3);
    expect(r.resume.absents.map((a) => libelleAbsent(a))).toEqual(["Dupont en congé du 09/11 au 10/11", "Dupont en congé du 09/11 au 10/11", "Martin : congé demandé du 09/11 au 09/11"]);
    // Aucun motif ne sort dans les textes.
    const arret = plan({ contexte: { ...vide, arrets: [{ user_id: "d1", start_date: "2026-11-09", end_date: "2026-11-15", motif: "maladie" }] } });
    expect(JSON.stringify(arret.resume)).not.toMatch(/maladie/i);
    expect(arret.resume.absents.every((a) => a.raison === "absent" && a.du === null)).toBe(true);
    expect(messageGeneration(lundiCible, arret.resume)).not.toMatch(/maladie|arrêt/i);
    expect(plan({ contexte: { ...vide, inactifs: new Set(["d2"]) } }).resume.absents.map((a) => a.nom)).toEqual(["Martin"]);
    expect(plan({ contexte: { ...vide, sorties: new Map([["d2", "2026-11-05"]]) } }).resume.a_remplacer).toBe(1);
  });

  it("modèles : comblent les tournées sans affectation, sans doublon avec une copie", () => {
    const modeles: ModeleGeneration[] = [
      { service_id: "s1", tour_number: "12", departure_time: "07:00:00", weekdays: [1, 2, 3], default_vehicle_id: "v1" },
      { service_id: "s1", tour_number: "20", departure_time: "05:30", weekdays: [1, 6], default_vehicle_id: null },
    ];
    const r = plan({ modeles });
    // Tournée 12 : lundi et mardi viennent de la copie, mercredi du modèle (sans chauffeur).
    expect(r.lignes.filter((l) => l.tour_number === "12").map((l) => [l.start_at, l.origine, l.driver_id])).toEqual([
      [at("2026-11-09", "07:00"), "copie", "d1"],
      [at("2026-11-10", "07:00"), "copie", "d1"],
      [at("2026-11-11", "07:00"), "modele", null],
    ]);
    expect(r.lignes.filter((l) => l.tour_number === "20").map((l) => l.start_at)).toEqual([at("2026-11-09", "05:30"), at("2026-11-14", "05:30")]);
    expect(r.resume.sans_chauffeur_modeles).toBe(3);
    expect(r.resume.a_remplacer).toBe(3);
    const cases = r.lignes.map((l) => `${l.tour_number}|${l.start_at.slice(0, 10)}`);
    expect(new Set(cases).size).toBe(cases.length);
  });

  it("conflits : même véhicule au même instant sur deux chauffeurs", () => {
    const lignes = [
      { vehicle_id: "v1", driver_id: "d1", start_at: at("2026-11-09", "07:00"), status: "planned" },
      { vehicle_id: "v1", driver_id: "d2", start_at: at("2026-11-09", "07:00"), status: "planned" },
      { vehicle_id: "v1", driver_id: "d1", start_at: at("2026-11-10", "07:00"), status: "planned" },
    ];
    expect(compterConflitsVehicule(lignes)).toBe(1);
    const r = plan({ sources: [aff({ id: "p", driver_id: "d1", vehicle_id: "v9" }), aff({ id: "q", tour_number: "13", driver_id: "d2", vehicle_id: "v9" })] });
    expect(r.resume.conflits).toBe(1);
  });
});

describe("messages et résumés", () => {
  it("message de génération : titre, compteurs, liste des absents", () => {
    const resume = { ...resumeVide(), tournees: 24, chauffeurs: 18, a_remplacer: 2, fermees: 1, absents: [{ entree_id: "e1", jour: "2026-11-12", heure: "07:00", tournee: "12", nom: "Dupont", raison: "conge" as const, du: "2026-11-12", au: "2026-11-14" }] };
    const m = messageGeneration("2026-11-09", resume, "Colis");
    expect(m.split("\n")[0]).toBe("Planning du lundi 9 au dimanche 15 novembre généré : à confirmer avant vendredi 17 h — Colis");
    expect(m).toContain("24 tournées planifiées, 18 chauffeurs affectés, 2 cases à remplacer, 1 tournée fermée, 0 conflit.");
    expect(m).toContain("À remplacer : Dupont en congé du 12/11 au 14/11.");
    expect(cleAlerteGeneration("s1", "2026-11-09")).toBe("planning:a_confirmer:s1:2026-11-09");
  });

  it("résumé lu en base, tolérant", () => {
    expect(lireResume(null)).toEqual(resumeVide());
    expect(lireResume({ tournees: 3, absents: [{ nom: "X", raison: "absent" }, 4] }).absents).toHaveLength(1);
    expect(cumulerResumes({ ...resumeVide(), tournees: 3, a_remplacer: 1 }, { ...resumeVide(), tournees: 2, a_remplacer: 1 }).tournees).toBe(5);
  });

  it("absence apparue après la génération", () => {
    const m = messageAbsenceApparue({ nom: "Dupont", du: "2026-11-12", au: "2026-11-14", lundi: "2026-11-09", nombre: 2, service: "Colis" });
    expect(m).toContain("Dupont en congé du 12/11 au 14/11");
    expect(m).toContain("2 tournées sont à remplacer");
  });
});

describe("semaine masquée aux chauffeurs", () => {
  const lignes = [
    { service_id: "s1", semaine_debut: "2026-11-09", publie_at: null },
    { service_id: "s2", semaine_debut: "2026-11-09", publie_at: "2026-11-06T16:00:00Z" },
  ];
  it("seules les semaines suivies et non publiées sont masquées", () => {
    const m = semainesMasquees(lignes);
    expect(estMasquee(m, { service_id: "s1", start_at: at("2026-11-12", "07:00") })).toBe(true);
    expect(estMasquee(m, { service_id: "s2", start_at: at("2026-11-12", "07:00") })).toBe(false);
    expect(estMasquee(m, { service_id: "s1", start_at: at("2026-11-16", "07:00") })).toBe(false);
    // Dimanche soir tard (heure de Paris) : encore la même semaine.
    expect(estMasquee(m, { service_id: "s1", start_at: at("2026-11-15", "23:30") })).toBe(true);
  });

  it("le résumé du vendredi ignore les services publiés depuis moins de 20 h", () => {
    const maintenant = new Date("2026-11-06T16:10:00Z");
    const recents = servicesPublieesRecemment(
      [
        { service_id: "s1", validated_at: "2026-11-06T16:00:00Z" },
        { service_id: "s2", validated_at: "2026-11-04T10:00:00Z" },
      ],
      maintenant,
    );
    expect([...recents]).toEqual(["s1"]);
  });
});

describe("bandeau de la vue Semaine", () => {
  const suivi = (p: Partial<LigneSuivi> = {}): LigneSuivi => ({
    id: "l1",
    organization_id: "o1",
    service_id: "s1",
    semaine_debut: "2026-11-09",
    genere_at: "2026-11-05T04:00:00Z",
    modifie_at: null,
    confirme_at: null,
    confirme_par: null,
    publie_at: null,
    publie_mode: null,
    rappel_envoye_at: null,
    resume: { ...resumeVide(), tournees: 3, chauffeurs: 2, a_remplacer: 1, absents: [{ entree_id: "e2", jour: "2026-11-10", heure: "07:00", tournee: "12", nom: "Dupont", raison: "conge", du: "2026-11-10", au: "2026-11-12" }] },
    ...p,
  });
  const ligne = (id: string, p: Record<string, unknown> = {}) => ({ id, service_id: "s1", tour_number: "12", driver_id: "d2", start_at: at("2026-11-09", "07:00"), status: "planned", nom_chauffeur: "Martin", ...p });

  it("cases à remplacer relues en direct, avec le nom de l'absent et un lien vers la case", () => {
    const b = construireBandeau({ ligne: suivi(), service: "Colis", lignes: [ligne("e1"), ligne("e2", { driver_id: null, nom_chauffeur: null, start_at: at("2026-11-10", "07:00") })], contexte: vide, peutConfirmer: true })!;
    expect(b.titre).toBe("Planning du lundi 9 au dimanche 15 novembre généré automatiquement — à confirmer avant vendredi 17 h");
    expect(b.etat).toBe("a_confirmer");
    expect(b.compteurs.aRemplacer).toBe(1);
    expect(b.aRemplacer[0]!.texte).toBe("mar. 10/11 07:00 · n°12 — Dupont en congé du 10/11 au 12/11");
    expect(b.aRemplacer[0]!.href).toBe("/exploitation/planning?entry=e2&service=s1");
  });

  it("congé approuvé après la génération : chauffeur affecté mais absent, signalé sans motif", () => {
    const contexte: ContexteAbsences = { ...vide, conges: [{ driver_id: "d2", start_date: "2026-11-09", end_date: "2026-11-09", status: "approved" }] };
    const b = construireBandeau({ ligne: suivi({ modifie_at: "2026-11-05T10:00:00Z" }), service: "Colis", lignes: [ligne("e1")], contexte, peutConfirmer: false })!;
    expect(b.etat).toBe("modifiee");
    expect(b.absentsApparus.map((a) => a.texte)).toEqual(["lun. 09/11 07:00 · n°12 — Martin en congé du 09/11 au 09/11"]);
    expect(b.peutConfirmer).toBe(false);
  });

  it("semaine plus lointaine : titre « préparé à l'avance », envoi seulement à la confirmation, boutons toujours proposés", () => {
    const b = construireBandeau({ ligne: suivi({ semaine_debut: "2026-11-23" }), service: "Colis", lignes: [], contexte: vide, peutConfirmer: true, aujourdhui: "2026-11-03" })!;
    expect(b.envoiAuto).toBe(false);
    expect(b.titre).toContain("préparé à l'avance");
    expect(b.etat).toBe("a_confirmer");
    expect(b.peutConfirmer).toBe(true);
    // La semaine suivante garde le titre du jeudi.
    const n1 = construireBandeau({ ligne: suivi(), service: "Colis", lignes: [], contexte: vide, peutConfirmer: true, aujourdhui: "2026-11-03" })!;
    expect(n1.envoiAuto).toBe(true);
    expect(n1.titre).toContain("à confirmer avant vendredi 17 h");
  });

  it("semaine publiée : mention « publiée aux chauffeurs le … » sans bouton, tant que la semaine n'a pas commencé", () => {
    const publiee = suivi({ semaine_debut: "2026-11-23", publie_at: "2026-11-06T16:12:00Z", publie_mode: "auto" });
    const b = construireBandeau({ ligne: publiee, service: "Colis", lignes: [], contexte: vide, peutConfirmer: true, aujourdhui: "2026-11-03" })!;
    expect(b).toMatchObject({ etat: "publiee", peutConfirmer: false, publieAuto: true });
    expect(b.titre).toBe("Semaine publiée aux chauffeurs le vendredi 6 novembre à 17:12");
    // Semaine commencée : plus de mention.
    expect(construireBandeau({ ligne: publiee, service: "Colis", lignes: [], contexte: vide, peutConfirmer: true, aujourdhui: "2026-11-23" })).toBeNull();
  });

  it("aucun bandeau une fois la semaine publiée ; tournée fermée sans chauffeur n'est pas une case à remplacer", () => {
    expect(construireBandeau({ ligne: suivi({ publie_at: "2026-11-06T16:00:00Z" }), service: "Colis", lignes: [], contexte: vide, peutConfirmer: true })).toBeNull();
    expect(casesSansChauffeur([ligne("e3", { driver_id: null, tour_open: false })])).toEqual([]);
  });
});

describe("génération à la demande : fenêtre, source, envoi automatique", () => {
  // Mardi 3 novembre 2026 : la semaine suivante commence le lundi 9.
  const MARDI = "2026-11-03";

  it("fenêtre : de la semaine suivante à 8 semaines plus loin, jamais la semaine en cours ni le passé", () => {
    const lundis = semainesPreparables(MARDI);
    expect(lundis).toHaveLength(SEMAINES_A_L_AVANCE);
    expect(lundis[0]).toBe("2026-11-09");
    expect(lundis.at(-1)).toBe("2026-12-28");
    expect(estSemainePreparable("2026-11-09", MARDI)).toBe(true);
    expect(estSemainePreparable("2026-12-28", MARDI)).toBe(true);
    expect(estSemainePreparable("2027-01-04", MARDI)).toBe(false);
    expect(estSemainePreparable("2026-11-02", MARDI)).toBe(false);
    expect(estSemainePreparable("2026-10-26", MARDI)).toBe(false);
    // Pas un lundi : refusé.
    expect(estSemainePreparable("2026-11-10", MARDI)).toBe(false);
    // Dimanche soir à Paris : la semaine suivante est déjà celle du lendemain.
    expect(semainesPreparables("2026-11-08")[0]).toBe("2026-11-09");
    expect(semainesPreparables("2026-11-09")[0]).toBe("2026-11-16");
  });

  it("source : la plus proche semaine AVANT la cible qui a des affectations, 4 semaines au plus", () => {
    const avec = new Set(["2026-11-02", "2026-10-19"]);
    expect(choisirSemaineSource("2026-11-09", avec)).toBe("2026-11-02");
    expect(choisirSemaineSource("2026-11-16", avec)).toBe("2026-11-02");
    expect(choisirSemaineSource("2026-11-23", avec)).toBe("2026-11-02");
    expect(choisirSemaineSource("2026-11-30", avec)).toBe("2026-11-02");
    // 5 semaines d'écart : trop loin.
    expect(choisirSemaineSource("2026-12-07", avec)).toBeNull();
    expect(choisirSemaineSource("2026-11-09", new Set())).toBeNull();
    // Une semaine à venir préparée (N+1) devient la source de N+2.
    expect(choisirSemaineSource("2026-11-16", new Set(["2026-11-09", "2026-11-02"]))).toBe("2026-11-09");
  });

  it("une semaine « a des affectations » si elle compte une ligne recopiable (chauffeur, véhicule, tournée ouverte)", () => {
    const lignes = [
      aff({ id: "a", start_at: at("2026-11-02", "07:00") }),
      aff({ id: "b", start_at: at("2026-11-10", "07:00"), driver_id: null }),
      aff({ id: "c", start_at: at("2026-11-17", "07:00"), tour_open: false }),
      aff({ id: "d", start_at: at("2026-11-24", "07:00"), status: "cancelled" }),
    ];
    expect([...lundisAvecAffectations(lignes)]).toEqual(["2026-11-02"]);
  });

  it("seule la semaine suivante part toute seule : N+2 et plus restent en attente de confirmation", () => {
    expect(envoiAutomatiquePrevu("2026-11-09", MARDI)).toBe(true);
    expect(envoiAutomatiquePrevu("2026-11-16", MARDI)).toBe(false);
    expect(envoiAutomatiquePrevu("2026-11-23", MARDI)).toBe(false);
    const vendredi17h = new Date("2026-11-06T16:30:00Z");
    const ligne = (semaine_debut: string) => ({ semaine_debut, modifie_at: null, confirme_at: null, publie_at: null, rappel_envoye_at: null });
    expect(decisionEnvoiAuto({ ligne: ligne("2026-11-09"), maintenant: vendredi17h })).toEqual({ action: "publier" });
    expect(decisionEnvoiAuto({ ligne: ligne("2026-11-16"), maintenant: vendredi17h })).toEqual({ action: "rien", raison: "mauvaise_semaine" });
    expect(decisionEnvoiAuto({ ligne: ligne("2026-12-07"), maintenant: vendredi17h })).toEqual({ action: "rien", raison: "mauvaise_semaine" });
  });

  it("copie depuis une semaine plus ancienne : jours décalés de 14 jours, tournées fermées comprises", () => {
    const plan = planifierSemaineSuivante({
      lundiSource: "2026-11-02",
      lundiCible: "2026-11-16",
      sources: [
        aff({ id: "a1", tour_number: "12", start_at: at("2026-11-02", "07:00") }),
        aff({ id: "a2", tour_number: "14", driver_id: "d2", vehicle_id: "v2", start_at: at("2026-11-03", "08:30") }),
        aff({ id: "a3", tour_number: "20", driver_id: "d3", vehicle_id: "v3", start_at: at("2026-11-04", "08:00"), tour_open: false }),
      ],
      existantes: [],
      modeles: [{ service_id: "s1", tour_number: "20", departure_time: "08:00:00", weekdays: [3], default_vehicle_id: null }],
      contexte: vide,
      nomDe,
    });
    expect(plan.lignes.map((l) => [l.tour_number, l.start_at])).toEqual([
      ["12", at("2026-11-16", "07:00")],
      ["14", at("2026-11-17", "08:30")],
    ]);
    // La tournée 20 fermée le mercredi 4 est aussi fermée le mercredi 18 : pas comblée par le modèle.
    expect(plan.resume.fermees).toBe(1);
  });

  it("bandeau « pas encore préparée » : bouton explicite, ou message s'il n'y a rien à recopier", () => {
    const lignes = [aff({ id: "a", start_at: at("2026-11-02", "07:00") })];
    const a = semaineAPreparer({ serviceId: "s1", service: "Colis", lundi: "2026-11-23", aujourdhui: MARDI, dejaSuivie: false, lignesSources: lignes })!;
    expect(a.titre).toBe("Cette semaine n'est pas encore préparée");
    expect(a.source).toBe("2026-11-02");
    expect(a.bouton).toBe("Générer le planning de la semaine du lundi 23 novembre à partir de la semaine du lundi 2 novembre");
    const sans = semaineAPreparer({ serviceId: "s1", service: "Colis", lundi: "2026-11-23", aujourdhui: MARDI, dejaSuivie: false, lignesSources: [] })!;
    expect(sans).toMatchObject({ bouton: null, message: MESSAGE_SANS_SOURCE });
    // Déjà suivie, hors fenêtre ou semaine en cours : rien à proposer.
    expect(semaineAPreparer({ serviceId: "s1", service: "Colis", lundi: "2026-11-23", aujourdhui: MARDI, dejaSuivie: true, lignesSources: lignes })).toBeNull();
    expect(semaineAPreparer({ serviceId: "s1", service: "Colis", lundi: "2026-11-02", aujourdhui: MARDI, dejaSuivie: false, lignesSources: lignes })).toBeNull();
    expect(semaineAPreparer({ serviceId: "s1", service: "Colis", lundi: "2027-03-01", aujourdhui: MARDI, dejaSuivie: false, lignesSources: lignes })).toBeNull();
  });
});
