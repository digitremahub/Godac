import { describe, expect, it } from "vitest";
import {
  affectationsParTournee,
  calendrierMois,
  cleCaseTournee,
  cleLigne,
  compteursDuJour,
  couleurChauffeur,
  decisionsAffectation,
  dimancheUtilise,
  estAbsent,
  estJourPrevu,
  etapesDeplacement,
  etatCase,
  etatChauffeurDuJour,
  indisponibilite,
  initiales,
  joursAffichesSemaine,
  joursChoisis,
  joursDeLaLigne,
  joursDuMois,
  jourParDefaut,
  joursEtires,
  joursPlacesParChauffeur,
  libelleIndisponibilite,
  lignesTournees,
  nomCourt,
  RANGS_LUNDI_SAMEDI,
  rangsDesJoursPrevus,
  PALETTE_CHAUFFEURS,
  sortFicheAncienChauffeur,
  texteAffectation,
  trousParJour,
  type ArretPlanning,
} from "@/lib/planning/affectation";
import { arretsRetenus } from "@/lib/planning/absences";
import { copiesSurSemaines, copiesVersDates, libelleJour, rangJour, planifierCopies, texteApercu, texteResultat, type AffectationPlanning, type CongePlanning } from "@/lib/planning/semaine";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";

const LUNDI = "2026-10-19";
const at = (date: string, heure: string) => parisWallTimeToUtcISOString(date, heure);
const jour = (i: number) => `2026-10-${String(19 + i).padStart(2, "0")}`;

function aff(p: Partial<AffectationPlanning> & { id: string }): AffectationPlanning {
  return { service_id: "s1", tour_number: "T101", driver_id: "d1", vehicle_id: "v1", start_at: at(LUNDI, "06:30"), status: "planned", ...p };
}

const conges: CongePlanning[] = [
  { driver_id: "d2", start_date: "2026-10-23", end_date: "2026-10-27", status: "approved" },
  { driver_id: "d3", start_date: "2026-10-20", end_date: "2026-10-20", status: "pending" },
  { driver_id: "d4", start_date: "2026-10-01", end_date: "2026-10-30", status: "rejected" },
];
const arrets: ArretPlanning[] = [{ user_id: "d5", start_date: "2026-10-19", end_date: "2026-11-02", motif: "maladie" }];

describe("absences", () => {
  it("congé validé, arrêt, congé demandé", () => {
    expect(indisponibilite("d2", "2026-10-24", conges, arrets)).toEqual({ type: "conge", fin: "2026-10-27" });
    expect(indisponibilite("d2", "2026-10-22", conges, arrets)).toBeNull();
    expect(indisponibilite("d5", "2026-10-21", conges, arrets)).toEqual({ type: "arret", fin: "2026-11-02", motif: "maladie" });
    expect(indisponibilite("d3", "2026-10-20", conges, arrets)).toEqual({ type: "conge_demande", fin: "2026-10-20" });
    expect(indisponibilite("d4", "2026-10-20", conges, arrets)).toBeNull();
  });

  it("absent = congé validé ou arrêt, pas une simple demande", () => {
    expect(estAbsent("d2", "2026-10-23", conges, arrets)).toBe(true);
    expect(estAbsent("d5", "2026-10-30", conges, arrets)).toBe(true);
    expect(estAbsent("d3", "2026-10-20", conges, arrets)).toBe(false);
  });

  it("l'arrêt l'emporte sur le congé", () => {
    const c: CongePlanning[] = [{ driver_id: "d5", start_date: "2026-10-19", end_date: "2026-10-20", status: "approved" }];
    expect(indisponibilite("d5", "2026-10-19", c, arrets)?.type).toBe("arret");
  });

  it("libellés avec le motif", () => {
    expect(libelleIndisponibilite({ type: "conge", fin: "2026-10-27" })).toBe("Congé jusqu'au 27/10");
    expect(libelleIndisponibilite({ type: "arret", fin: "2026-11-02", motif: "maladie" })).toBe("Arrêt maladie jusqu'au 02/11");
    expect(libelleIndisponibilite({ type: "arret", fin: "2026-11-02", motif: "at_mp" })).toBe("Accident du travail jusqu'au 02/11");
    expect(libelleIndisponibilite({ type: "arret", fin: "2026-11-02", motif: null })).toBe("Arrêt de travail jusqu'au 02/11");
  });

  it("arrêt refusé ignoré, colonne status absente tolérée", () => {
    expect(
      arretsRetenus([
        { user_id: "a", stoppage_type: "maladie", start_date: "2026-10-01", end_date: "2026-10-02", status: "refuse" },
        { user_id: "b", stoppage_type: "at_mp", start_date: "2026-10-01", end_date: "2026-10-02", status: "recu" },
        { user_id: "c", stoppage_type: "trajet", start_date: "2026-10-01", end_date: "2026-10-02" },
      ]).map((a) => [a.user_id, a.motif]),
    ).toEqual([
      ["b", "at_mp"],
      ["c", "trajet"],
    ]);
  });
});

describe("lignes de tournées", () => {
  const routes = [
    { id: "r2", tourNumber: "T102", serviceId: "s1", villages: ["Canet"] },
    { id: "r10", tourNumber: "T10", serviceId: "s1" },
    { id: "rx", tourNumber: "X1", serviceId: "s2" },
    { id: "rn", tourNumber: "N1", serviceId: null },
  ];

  it("tournées-modèles du service + numéros saisis à la main, triées par heure puis numéro", () => {
    const lignes = lignesTournees({
      routes,
      modeles: [{ service_id: "s1", tour_number: "T102", departure_time: "06:30:00", weekdays: [1, 2, 3, 4, 5, 6], default_vehicle_id: null }],
      affectations: [aff({ id: "a", tour_number: "LIBRE", start_at: at(LUNDI, "13:30") }), aff({ id: "b", tour_number: "T10", start_at: at(LUNDI, "05:00") })],
      serviceIds: ["s1"],
    });
    expect(lignes.map((l) => l.tourNumber)).toEqual(["T10", "T102", "N1", "LIBRE"]);
    const t102 = lignes.find((l) => l.tourNumber === "T102")!;
    expect(t102.heure).toBe("06:30");
    expect(t102.joursPrevus).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t102.villages).toEqual(["Canet"]);
    // Sans modèle : lundi → vendredi, heure la plus fréquente des affectations.
    expect(lignes.find((l) => l.tourNumber === "T10")!.joursPrevus).toEqual([1, 2, 3, 4, 5]);
    expect(lignes.find((l) => l.tourNumber === "LIBRE")!.heure).toBe("13:30");
  });

  it("tournée sans service : seulement avec un service par défaut", () => {
    const lignes = lignesTournees({ routes, modeles: [], affectations: [], serviceIds: ["s1", "s2"] });
    expect(lignes.map((l) => l.tourNumber).sort()).toEqual(["T10", "T102", "X1"]);
    const avecDefaut = lignesTournees({ routes, modeles: [], affectations: [], serviceIds: ["s1", "s2"], serviceParDefaut: "s2" });
    expect(avecDefaut.find((l) => l.tourNumber === "N1")?.serviceId).toBe("s2");
  });

  it("jours prévus", () => {
    const ligne = { joursPrevus: [1, 2, 3, 4, 5] };
    expect(estJourPrevu(ligne, "2026-10-19")).toBe(true); // lundi
    expect(estJourPrevu(ligne, "2026-10-24")).toBe(false); // samedi
  });
});

describe("cases et trous", () => {
  const lignes = lignesTournees({ routes: [{ id: "r1", tourNumber: "T101", serviceId: "s1" }, { id: "r2", tourNumber: "T102", serviceId: "s1" }], modeles: [], affectations: [], serviceIds: ["s1"] });
  const affectations = [aff({ id: "a" }), aff({ id: "b", tour_number: "T102", driver_id: null }), aff({ id: "c", start_at: at(jour(1), "06:30") })];
  const parCase = affectationsParTournee(affectations);

  it("états", () => {
    expect(etatCase(parCase.get(cleCaseTournee(cleLigne("s1", "T101"), LUNDI)) ?? [], true)).toBe("remplie");
    expect(etatCase(parCase.get(cleCaseTournee(cleLigne("s1", "T102"), LUNDI)) ?? [], true)).toBe("a_remplacer");
    expect(etatCase([], true)).toBe("vide_prevue");
    expect(etatCase([], false)).toBe("vide");
  });

  it("trous par jour : à remplacer + prévues vides, pas le samedi non prévu", () => {
    expect(trousParJour(lignes, [LUNDI, jour(1), jour(2), jour(5)], parCase)).toEqual({ [LUNDI]: 1, [jour(1)]: 1, [jour(2)]: 2, [jour(5)]: 0 });
  });

  it("compteurs du jour", () => {
    const c = compteursDuJour({
      date: LUNDI,
      lignes,
      parCase,
      chauffeurs: [{ id: "d1" }, { id: "d2" }, { id: "d5" }],
      affectations,
      conges,
      arrets,
    });
    expect(c).toEqual({ tournees: 2, affectees: 1, sansChauffeur: 1, disponibles: 1, absents: 1 });
  });
});

describe("étirer, toute la semaine", () => {
  const jours = joursAffichesSemaine(LUNDI, false);
  it("6 jours sans dimanche, 7 avec", () => {
    expect(jours).toHaveLength(6);
    expect(joursAffichesSemaine(LUNDI, true).at(-1)).toBe("2026-10-25");
  });
  it("jours après la source jusqu'à la cible incluse", () => {
    expect(joursEtires(jour(3), jour(5), jours)).toEqual([jour(4), jour(5)]);
    expect(joursEtires(jour(3), jour(1), jours)).toEqual([]);
    expect(joursEtires(jour(3), jour(3), jours)).toEqual([]);
    // Dimanche masqué : sauté, même si on vise le lundi suivant d'un mois.
    expect(joursEtires(jour(5), "2026-10-26", [...jours, "2026-10-26"])).toEqual(["2026-10-26"]);
  });
  it("toute la semaine = jours prévus, sinon lundi → vendredi", () => {
    expect(joursDeLaLigne({ joursPrevus: [1, 3, 6] }, jours)).toEqual([jour(0), jour(2), jour(5)]);
    expect(joursDeLaLigne({ joursPrevus: [0] }, jours)).toEqual(jours.slice(0, 5));
  });
  it("dimanche utilisé", () => {
    expect(dimancheUtilise([aff({ id: "a", start_at: at("2026-10-25", "08:00") })], [])).toBe(true);
    expect(dimancheUtilise([aff({ id: "a" })], [])).toBe(false);
  });
});

describe("chauffeurs", () => {
  it("couleur stable, dans la palette", () => {
    const c = couleurChauffeur("11111111-2222-3333-4444-555555555555");
    expect(couleurChauffeur("11111111-2222-3333-4444-555555555555")).toEqual(c);
    expect(PALETTE_CHAUFFEURS).toContainEqual(c);
    // Des identifiants différents se répartissent sur plusieurs couleurs.
    const couleurs = new Set(Array.from({ length: 40 }, (_, i) => couleurChauffeur(`chauffeur-${i}`).fond));
    expect(couleurs.size).toBeGreaterThan(5);
  });
  it("initiales et nom court", () => {
    expect(initiales("Karim Mansouri")).toBe("KM");
    expect(initiales("Jean-Paul Durand")).toBe("JD");
    expect(initiales("laura")).toBe("LA");
    expect(initiales("  ")).toBe("?");
    expect(nomCourt("Karim Mansouri")).toBe("Karim M.");
    expect(nomCourt("Laura")).toBe("Laura");
  });
  it("jours placés : jours distincts de la période", () => {
    const m = joursPlacesParChauffeur(
      [aff({ id: "a" }), aff({ id: "b", tour_number: "T106", start_at: at(LUNDI, "13:30") }), aff({ id: "c", start_at: at(jour(1), "06:30") }), aff({ id: "d", start_at: at("2026-11-02", "06:30") }), aff({ id: "e", driver_id: null })],
      [LUNDI, jour(1)],
    );
    expect(m.get("d1")).toBe(2);
    expect(m.size).toBe(1);
  });
  it("état du jour : absent, pris, disponible", () => {
    const affectations = [aff({ id: "a" }), aff({ id: "b", tour_number: "T106", start_at: at(LUNDI, "13:30") })];
    expect(etatChauffeurDuJour("d1", LUNDI, affectations, conges, arrets)).toMatchObject({ etat: "pris", tournees: ["T101", "T106"] });
    expect(etatChauffeurDuJour("d5", LUNDI, affectations, conges, arrets).etat).toBe("absent");
    expect(etatChauffeurDuJour("d3", jour(1), affectations, conges, arrets)).toMatchObject({ etat: "disponible", indispo: { type: "conge_demande" } });
  });
});

describe("déplacer, échanger (vue Jour)", () => {
  const source = { entreeId: "a", driverId: "d1", cle: "s1|T101", date: LUNDI };
  it("vers une tournée vide : retirer puis placer", () => {
    expect(etapesDeplacement({ source, cible: { cle: "s1|T103", date: LUNDI, entreeId: null, driverId: null } })).toEqual([
      { type: "retirer", entreeId: "a" },
      { type: "placer", cle: "s1|T103", date: LUNDI, driverId: "d1" },
    ]);
  });
  it("vers une tournée tenue : échange", () => {
    expect(etapesDeplacement({ source, cible: { cle: "s1|T102", date: LUNDI, entreeId: "b", driverId: "d2" } })).toEqual([
      { type: "retirer", entreeId: "a" },
      { type: "retirer", entreeId: "b" },
      { type: "placer", cle: "s1|T102", date: LUNDI, driverId: "d1" },
      { type: "placer", cle: "s1|T101", date: LUNDI, driverId: "d2" },
    ]);
  });
  it("sur elle-même : rien", () => {
    expect(etapesDeplacement({ source, cible: { cle: "s1|T101", date: LUNDI, entreeId: "a", driverId: "d1" } })).toEqual([]);
  });
});

describe("placer un chauffeur sur des jours", () => {
  const existantes = [
    aff({ id: "lun", driver_id: null }),
    aff({ id: "mar", driver_id: "d9", start_at: at(jour(1), "06:30") }),
    aff({ id: "mer", driver_id: "d9", start_at: at(jour(2), "06:30"), status: "in_progress" }),
    aff({ id: "jeu", driver_id: "d2", start_at: at(jour(3), "06:30") }),
  ];
  const absent = (d: string, date: string) => estAbsent(d, date, conges, arrets);
  it("créer, changer, figée, déjà là", () => {
    const r = decisionsAffectation({ dates: [jour(4), LUNDI, jour(1), jour(2), jour(3)], driverId: "d2", heure: "06:30", existantes, absent, versUtc: at });
    expect(r).toEqual([
      { type: "changer", date: LUNDI, entreeId: "lun", ancienChauffeur: null },
      { type: "changer", date: jour(1), entreeId: "mar", ancienChauffeur: "d9" },
      { type: "rien", date: jour(2), raison: "figee" },
      { type: "rien", date: jour(3), raison: "deja" },
      // d2 en congé le vendredi 23 : case vide → affectation à remplacer.
      { type: "creer", date: jour(4), startAt: at(jour(4), "06:30"), driverId: null },
    ]);
  });
  it("absent sur une case tenue : on n'y touche pas", () => {
    const r = decisionsAffectation({ dates: [jour(1)], driverId: "d5", heure: "06:30", existantes, absent, versUtc: at });
    expect(r).toEqual([{ type: "rien", date: jour(1), raison: "absent" }]);
  });
  it("résumé", () => {
    expect(texteAffectation({ places: 3, absents: [jour(4)], figees: 1, deja: 0 }, libelleJour)).toBe("3 jours placés, ven. 23/10 à remplacer (absent), 1 tournée déjà démarrée, inchangée");
    expect(texteAffectation({ places: 0, absents: [], figees: 0, deja: 0 }, libelleJour)).toBe("Rien à changer");
  });
});

describe("recopie et absences", () => {
  it("chauffeur en congé le jour cible : créée sans chauffeur, à remplacer", () => {
    const source = aff({ id: "s", driver_id: "d2", start_at: at("2026-10-16", "06:30") }); // vendredi précédent
    const plan = planifierCopies(copiesVersDates([source], [jour(3), jour(4)]), [], { absent: (d, date) => estAbsent(d, date, conges, arrets) });
    expect(plan.aCreer.map((l) => l.driver_id)).toEqual(["d2", null]);
    expect(plan.aRemplacer).toHaveLength(1);
    expect(plan.aRemplacer[0]!.vehicle_id).toBe("v1");
    expect(plan.conflits).toEqual([]);
  });
  it("semaine recopiée : arrêt maladie sur toute la semaine", () => {
    const semaine = [0, 1, 2].map((i) => aff({ id: `x${i}`, driver_id: "d5", start_at: at(`2026-10-${12 + i}`, "06:30") }));
    const plan = planifierCopies(copiesSurSemaines(semaine, 1), [], { absent: (d, date) => estAbsent(d, date, conges, arrets) });
    expect(plan.aRemplacer).toHaveLength(3);
    expect(plan.aCreer.every((l) => l.driver_id === null)).toBe(true);
  });
  it("sans fonction d'absence : comportement inchangé", () => {
    const plan = planifierCopies(copiesVersDates([aff({ id: "s", driver_id: "d2" })], [jour(4)]), []);
    expect(plan.aCreer[0]!.driver_id).toBe("d2");
    expect(plan.aRemplacer).toEqual([]);
  });
  it("textes", () => {
    expect(texteApercu({ creees: 4, ignorees: 0, conflits: 0, aRemplacer: 1 })).toBe("4 affectations seront créées, 1 à remplacer (chauffeur en congé ou en arrêt ce jour-là)");
    expect(texteResultat({ creees: 2, ignorees: 0, conflits: 0, aRemplacer: 1 })).toBe("2 créées, 0 ignorée (déjà occupée), 0 en conflit, 1 à remplacer (absent)");
  });
});

describe("fiche colis de l'ancien chauffeur", () => {
  const base = { statut: "loading", arretsTraites: 0, autresEntrees: 0, fichePlanifiee: true, creeePourCetteAffectation: true };
  it("fiche de cette seule affectation, pas commencée : supprimée", () => expect(sortFicheAncienChauffeur(base)).toBe("supprimer"));
  it("fiche reliée à d'autres tournées : détachée", () => expect(sortFicheAncienChauffeur({ ...base, autresEntrees: 1 })).toBe("detacher"));
  it("fiche libre : détachée", () => expect(sortFicheAncienChauffeur({ ...base, fichePlanifiee: false, creeePourCetteAffectation: false })).toBe("detacher"));
  it("fiche commencée : gardée", () => {
    expect(sortFicheAncienChauffeur({ ...base, statut: "in_progress" })).toBe("garder");
    expect(sortFicheAncienChauffeur({ ...base, arretsTraites: 2 })).toBe("garder");
  });
});

describe("jours habituels déduits de l'historique", () => {
  const SAMEDI = jour(5);
  const DIMANCHE = jour(6);
  const routes = [{ id: "r1", tourNumber: "T101", serviceId: "s1" }];
  const lignesAvec = (modeles: Parameters<typeof lignesTournees>[0]["modeles"], affectations: AffectationPlanning[]) =>
    lignesTournees({ routes, modeles, affectations, serviceIds: ["s1"] }).find((l) => l.tourNumber === "T101")!;

  it("sans modèle ni historique : lundi → vendredi", () => {
    expect(lignesAvec([], []).joursPrevus).toEqual([1, 2, 3, 4, 5]);
  });

  it("sans modèle : le samedi (ou le dimanche) avec une affectation devient un jour habituel", () => {
    expect(lignesAvec([], [aff({ id: "s", start_at: at(SAMEDI, "06:30") })]).joursPrevus).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lignesAvec([], [aff({ id: "s", start_at: at(SAMEDI, "06:30") }), aff({ id: "d", start_at: at(DIMANCHE, "06:30") })]).joursPrevus).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("sans modèle : un jour de semaine ou une affectation annulée ne change rien", () => {
    expect(lignesAvec([], [aff({ id: "m", start_at: at(jour(1), "06:30") })]).joursPrevus).toEqual([1, 2, 3, 4, 5]);
    expect(lignesAvec([], [aff({ id: "x", start_at: at(SAMEDI, "06:30"), status: "cancelled" })]).joursPrevus).toEqual([1, 2, 3, 4, 5]);
  });

  it("avec modèle : modèle + jours où elle a des affectations", () => {
    const modele = [{ service_id: "s1", tour_number: "T101", departure_time: "06:30:00", weekdays: [1, 3], default_vehicle_id: null }];
    expect(lignesAvec(modele, []).joursPrevus).toEqual([1, 3]);
    expect(lignesAvec(modele, [aff({ id: "s", start_at: at(SAMEDI, "06:30") }), aff({ id: "m", start_at: at(jour(1), "06:30") })]).joursPrevus).toEqual([1, 2, 3, 6]);
  });

  it("le samedi habituel compte comme trou quand il est vide", () => {
    const l = lignesAvec([], [aff({ id: "s", start_at: at(SAMEDI, "06:30") })]);
    expect(trousParJour([l], [SAMEDI, DIMANCHE], affectationsParTournee([]))).toEqual({ [SAMEDI]: 1, [DIMANCHE]: 0 });
  });
});

describe("jours choisis pour « toute la semaine »", () => {
  const semaine = joursAffichesSemaine(LUNDI, true);
  it("rangs des jours habituels (0 = lundi)", () => {
    expect(rangsDesJoursPrevus([1, 2, 3, 4, 5])).toEqual([0, 1, 2, 3, 4]);
    expect(rangsDesJoursPrevus([0, 6])).toEqual([5, 6]);
  });
  it("jours cochés, sans ceux déjà passés", () => {
    expect(joursChoisis(semaine, RANGS_LUNDI_SAMEDI)).toEqual(semaine.slice(0, 6));
    expect(joursChoisis(semaine, [5])).toEqual([jour(5)]);
    expect(joursChoisis(semaine, RANGS_LUNDI_SAMEDI, jour(3))).toEqual([jour(3), jour(4), jour(5)]);
    expect(joursChoisis(semaine, [])).toEqual([]);
  });
});

describe("calendrier du mois (téléphone)", () => {
  const routes = [
    { id: "r1", tourNumber: "T101", serviceId: "s1" },
    { id: "r2", tourNumber: "T102", serviceId: "s1" },
  ];
  // Octobre 2026 : le 1er est un jeudi, le 31 un samedi.
  const affectations = [
    aff({ id: "a", start_at: at("2026-10-05", "06:30") }),
    aff({ id: "b", tour_number: "T102", start_at: at("2026-10-05", "06:30"), driver_id: "d2" }),
    aff({ id: "c", start_at: at("2026-10-06", "06:30") }),
    aff({ id: "d", tour_number: "T102", start_at: at("2026-10-06", "06:30"), driver_id: null }),
    aff({ id: "e", start_at: at("2026-10-10", "06:30") }),
  ];
  const lignes = lignesTournees({ routes, modeles: [], affectations, serviceIds: ["s1"] });
  const semaines = calendrierMois("2026-10", lignes, affectationsParTournee(affectations));
  const cellule = (d: string) => semaines.flatMap((s) => s.jours).find((c) => c.date === d)!;

  it("semaines lundi → dimanche, jours des mois voisins compris", () => {
    expect(semaines).toHaveLength(5);
    expect(semaines.every((s) => s.jours.length === 7 && rangJour(s.lundi) === 0)).toBe(true);
    expect(semaines[0]!.lundi).toBe("2026-09-28");
    expect(semaines[0]!.jours.map((c) => c.dansMois)).toEqual([false, false, false, true, true, true, true]);
    expect(semaines.at(-1)!.jours.at(-1)!.date).toBe("2026-11-01");
    expect(semaines.at(-1)!.jours.at(-1)!.dansMois).toBe(false);
  });

  it("compteurs de trous par jour", () => {
    expect(cellule("2026-10-05")).toMatchObject({ tournees: 2, trous: 0, couverture: "complet" });
    expect(cellule("2026-10-06")).toMatchObject({ tournees: 2, trous: 1, couverture: "trous" });
    expect(cellule("2026-10-07")).toMatchObject({ tournees: 2, trous: 2, couverture: "trous" });
  });

  it("samedi placé : T101 roule aussi les autres samedis (trou) ; dimanche vide : aucune tournée", () => {
    expect(cellule("2026-10-03")).toMatchObject({ tournees: 1, trous: 1, couverture: "trous" });
    expect(cellule("2026-10-10")).toMatchObject({ tournees: 1, trous: 0, couverture: "complet" });
    expect(cellule("2026-10-11")).toMatchObject({ tournees: 0, couverture: "aucune" });
  });

  it("jours hors du mois : pas d'indicateur", () => {
    expect(cellule("2026-09-30")).toMatchObject({ dansMois: false, tournees: 0, trous: 0, couverture: "hors_mois" });
  });

  it("jours du mois, dimanche à la demande", () => {
    expect(joursDuMois("2026-10", true)).toHaveLength(31);
    expect(joursDuMois("2026-10", false)).toHaveLength(27);
    expect(joursDuMois("2026-10", false).every((d) => rangJour(d) !== 6)).toBe(true);
  });

  it("jour ouvert par défaut en vue Semaine", () => {
    const semaine = joursAffichesSemaine(LUNDI, true);
    expect(jourParDefaut(semaine, jour(2), {})).toBe(jour(2));
    expect(jourParDefaut(semaine, "2026-12-01", { [jour(3)]: 2, [jour(4)]: 1 })).toBe(jour(3));
    expect(jourParDefaut(semaine, "2026-12-01", {})).toBe(LUNDI);
  });
});
