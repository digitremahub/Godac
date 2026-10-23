import { describe, expect, it } from "vitest";
import {
  affectationsParCase,
  basculerRang,
  chauffeursAffiches,
  cleCase,
  congeDuJour,
  conflitsAffectation,
  copiesSurSemaines,
  copiesVersDates,
  cumulerResultats,
  datesCochees,
  estCopiable,
  estModifiable,
  heureDe,
  jourDe,
  libelleJour,
  planifierCopies,
  preRemplir,
  rangJour,
  rangsJusquaFinDeSemaine,
  texteApercu,
  texteResultat,
  type AffectationPlanning,
} from "@/lib/planning/semaine";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";

const LUNDI = "2026-10-19";
const at = (date: string, heure: string) => parisWallTimeToUtcISOString(date, heure);

function aff(p: Partial<AffectationPlanning> & { id: string }): AffectationPlanning {
  return { service_id: "s1", tour_number: "12", driver_id: "d1", vehicle_id: "v1", start_at: at(LUNDI, "07:00"), status: "planned", ...p };
}

describe("jours cochés", () => {
  it("bascule un jour sans doublon, trié", () => {
    expect(basculerRang([4, 0], 2)).toEqual([0, 2, 4]);
    expect(basculerRang([0, 2, 4], 2)).toEqual([0, 4]);
    expect(basculerRang([1], 9)).toEqual([1]);
  });
  it("jusqu'à la fin de la semaine depuis le mercredi", () => {
    expect(rangsJusquaFinDeSemaine(2)).toEqual([3, 4, 5, 6]);
    expect(rangsJusquaFinDeSemaine(6)).toEqual([]);
  });
  it("dates cochées sans le jour source", () => {
    expect(datesCochees(LUNDI, [0, 1, 4], "2026-10-19")).toEqual(["2026-10-20", "2026-10-23"]);
  });
  it("rang et libellé d'un jour", () => {
    expect(rangJour("2026-10-25")).toBe(6);
    expect(rangJour(LUNDI)).toBe(0);
    expect(libelleJour("2026-10-21")).toBe("mer. 21/10");
  });
});

describe("jour et heure de Paris", () => {
  it("lit l'heure et le jour de Paris, pas UTC", () => {
    const iso = at("2026-10-19", "00:30"); // 22:30 UTC la veille
    expect(jourDe(iso)).toBe("2026-10-19");
    expect(heureDe(iso)).toBe("00:30");
  });
});

describe("grille", () => {
  it("range par case et trie par heure", () => {
    const m = affectationsParCase([aff({ id: "b", start_at: at(LUNDI, "09:00") }), aff({ id: "a" }), aff({ id: "c", driver_id: null })]);
    expect(m.get(cleCase("d1", LUNDI))!.map((a) => a.id)).toEqual(["a", "b"]);
    expect(m.get(cleCase(null, LUNDI))!.map((a) => a.id)).toEqual(["c"]);
  });
  it("chauffeurs du service + ceux déjà affectés", () => {
    const chauffeurs = [
      { id: "d1", full_name: "Zoé" },
      { id: "d2", full_name: "Ali" },
      { id: "d3", full_name: "Bob" },
    ];
    const r = chauffeursAffiches(chauffeurs, [{ user_id: "d1", service_id: "s1" }, { user_id: "d2", service_id: "s2" }], ["s1"], [{ driver_id: "d3" }]);
    expect(r.map((c) => c.id)).toEqual(["d3", "d1"]);
    expect(chauffeursAffiches(chauffeurs, null, ["s1"], []).map((c) => c.full_name)).toEqual(["Ali", "Bob", "Zoé"]);
  });
  it("modifiable seulement si prévue", () => {
    expect(estModifiable({ status: "planned" })).toBe(true);
    expect(estModifiable({ status: "in_progress" })).toBe(false);
    expect(estModifiable({ status: "done" })).toBe(false);
  });
});

describe("congés et conflits", () => {
  const conges = [
    { driver_id: "d1", start_date: "2026-10-21", end_date: "2026-10-22", status: "approved" },
    { driver_id: "d2", start_date: "2026-10-19", end_date: "2026-10-19", status: "pending" },
    { driver_id: "d3", start_date: "2026-10-19", end_date: "2026-10-19", status: "rejected" },
  ];
  it("congé validé, demandé ou rien", () => {
    expect(congeDuJour("d1", "2026-10-22", conges)).toBe("approved");
    expect(congeDuJour("d1", "2026-10-23", conges)).toBeNull();
    expect(congeDuJour("d2", LUNDI, conges)).toBe("pending");
    expect(congeDuJour("d3", LUNDI, conges)).toBeNull();
  });
  it("même chauffeur à la même heure = combiné (pas d'avertissement) ; véhicule pris, congé", () => {
    const existantes = [aff({ id: "x" }), aff({ id: "y", driver_id: "d9", vehicle_id: "v2", tour_number: "40" })];
    const w = conflitsAffectation({ driverId: "d1", vehicleId: "v2", date: LUNDI, heure: "07:00" }, existantes, conges);
    expect(w).toEqual(["Véhicule déjà utilisé à 07:00 : n°40."]);
    expect(conflitsAffectation({ driverId: "d1", date: LUNDI, heure: "07:00", ignorerId: "x" }, existantes)).toEqual([]);
    expect(conflitsAffectation({ driverId: "d1", date: "2026-10-21", heure: "08:00" }, existantes, conges)).toEqual(["Chauffeur en congé ce jour-là."]);
  });
  it("une tournée terminée ou annulée n'est pas un conflit", () => {
    const existantes = [aff({ id: "x", status: "done" }), aff({ id: "z", status: "cancelled" })];
    expect(conflitsAffectation({ driverId: "d1", date: LUNDI, heure: "07:00" }, existantes)).toEqual([]);
  });
});

describe("pré-remplissage heure / véhicule", () => {
  const historique = [
    aff({ id: "old", start_at: at("2026-10-05", "06:00"), vehicle_id: "vA" }),
    aff({ id: "new", start_at: at("2026-10-12", "06:30"), vehicle_id: "vB" }),
    aff({ id: "autre", tour_number: "99", start_at: at("2026-10-13", "05:00"), vehicle_id: "vC" }),
  ];
  const modeles = [
    { service_id: "s1", tour_number: "12", departure_time: "08:15:00", weekdays: [1, 2, 3], default_vehicle_id: "vM" },
    { service_id: "s1", tour_number: "20", departure_time: "09:00:00", weekdays: [6], default_vehicle_id: null },
  ];
  const vehicules = [{ id: "vX", service_id: "s1", assigned_driver_id: "d2" }];

  it("dernière affectation du chauffeur sur cette tournée", () => {
    expect(preRemplir({ driverId: "d1", serviceId: "s1", tourNumber: "12", date: LUNDI }, { historique, modeles, vehicules })).toEqual({ heure: "06:30", vehiculeId: "vB", origine: "historique" });
  });
  it("sinon le modèle", () => {
    expect(preRemplir({ driverId: "d2", serviceId: "s1", tourNumber: "12", date: LUNDI }, { historique, modeles, vehicules })).toEqual({ heure: "08:15", vehiculeId: "vM", origine: "modele" });
  });
  it("modèle sans véhicule : véhicule attribué au chauffeur", () => {
    expect(preRemplir({ driverId: "d2", serviceId: "s1", tourNumber: "20", date: "2026-10-24" }, { historique, modeles, vehicules })).toEqual({ heure: "09:00", vehiculeId: "vX", origine: "modele" });
  });
  it("sinon véhicule attribué, 07:00", () => {
    expect(preRemplir({ driverId: "d2", serviceId: "s1", tourNumber: "55", date: LUNDI }, { historique, modeles, vehicules })).toEqual({ heure: "07:00", vehiculeId: "vX", origine: "vehicule" });
  });
  it("rien : valeurs par défaut", () => {
    expect(preRemplir({ driverId: "d7", serviceId: "s1", tourNumber: "55", date: LUNDI }, { historique, modeles, vehicules })).toEqual({ heure: "07:00", vehiculeId: "", origine: "defaut" });
  });
});

describe("duplications", () => {
  it("copie vers des jours, même heure de Paris (y compris au changement d'heure)", () => {
    // 23/10 heure d'été → 26/10 heure d'hiver : 07:00 reste 07:00.
    const source = aff({ id: "a", start_at: at("2026-10-23", "07:00") });
    const plan = planifierCopies(copiesVersDates([source], ["2026-10-26"]), [source]);
    expect(plan.aCreer).toHaveLength(1);
    expect(heureDe(plan.aCreer[0]!.start_at)).toBe("07:00");
    expect(jourDe(plan.aCreer[0]!.start_at)).toBe("2026-10-26");
  });

  it("ignore les créneaux déjà occupés et les doublons du plan ; deux tournées à la même heure pour un chauffeur = combiné, pas un conflit", () => {
    const a = aff({ id: "a" });
    const mardiOccupe = aff({ id: "m", start_at: at("2026-10-20", "07:00"), driver_id: "d2" }); // même tournée 12 à 07:00
    const mercrediAutre = aff({ id: "w", start_at: at("2026-10-21", "07:00"), tour_number: "30" }); // d1 pris à 07:00
    const demandes = [...copiesVersDates([a], ["2026-10-20", "2026-10-21", "2026-10-22"]), ...copiesVersDates([a], ["2026-10-22"])];
    const plan = planifierCopies(demandes, [a, mardiOccupe, mercrediAutre]);
    expect(plan.aCreer.map((r) => jourDe(r.start_at))).toEqual(["2026-10-21", "2026-10-22"]);
    expect(plan.ignorees).toHaveLength(2);
    expect(plan.conflits).toEqual([]);
  });

  it("copier / coller vers un autre chauffeur et un autre véhicule", () => {
    const a = aff({ id: "a" });
    const plan = planifierCopies(copiesVersDates([a], ["2026-10-20"], { driverId: "d2", vehicleId: "v9" }), [a]);
    expect(plan.aCreer[0]).toMatchObject({ driver_id: "d2", vehicle_id: "v9", tour_number: "12", service_id: "s1", sourceId: "a" });
  });

  it("semaine sur N semaines, aperçu créées / ignorées", () => {
    const semaine = [aff({ id: "a" }), aff({ id: "b", tour_number: "13", start_at: at("2026-10-20", "06:00") })];
    const dejaLa = aff({ id: "z", start_at: at("2026-10-26", "07:00") });
    const plan = planifierCopies(copiesSurSemaines(semaine, 3), [...semaine, dejaLa]);
    expect(plan.aCreer).toHaveLength(5);
    expect(plan.ignorees).toHaveLength(1);
    expect(copiesSurSemaines(semaine, 20)).toHaveLength(16);
    expect(copiesSurSemaines(semaine, 0)).toHaveLength(2);
    expect(texteApercu({ creees: 42, ignorees: 3, conflits: 0 })).toBe("42 affectations seront créées, 3 créneaux déjà occupés ignorés");
    expect(texteApercu({ creees: 1, ignorees: 0, conflits: 2 })).toBe("1 affectation sera créée, 2 en conflit (chauffeur déjà pris à la même heure)");
  });

  it("ne copie ni présence, ni annulée, ni ligne sans chauffeur ou véhicule", () => {
    expect(estCopiable(aff({ id: "a" }))).toBe(true);
    expect(estCopiable(aff({ id: "p", status: "presence" }))).toBe(false);
    expect(estCopiable(aff({ id: "c", status: "cancelled" }))).toBe(false);
    expect(estCopiable(aff({ id: "n", driver_id: null }))).toBe(false);
    expect(estCopiable(aff({ id: "v", vehicle_id: null }))).toBe(false);
  });

  it("résultat lisible et cumul", () => {
    const t = cumulerResultats([{ creees: 2, ignorees: 1 }, { creees: 1, conflits: 1 }]);
    expect(t).toEqual({ creees: 3, ignorees: 1, conflits: 1, aRemplacer: 0 });
    expect(texteResultat(t)).toBe("3 créées, 1 ignorée (déjà occupée), 1 en conflit");
    expect(texteResultat({ creees: 0, ignorees: 2, conflits: 0 })).toBe("0 créée, 2 ignorées (déjà occupées), 0 en conflit");
  });
});
