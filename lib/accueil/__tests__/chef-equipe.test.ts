import { describe, expect, it } from "vitest";
import { MODULES_AVEC_CODE } from "@/lib/acces/catalogue";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import {
  ancienneteJours,
  compterEquipe,
  compterVehicules,
  construireEquipe,
  construireVehicules,
  etatMembre,
  fusionner,
  libelleAnciennete,
  mentionHierarchie,
  motifSurveillance,
  plafonner,
  resumeEquipe,
  trierParAnciennete,
} from "@/lib/accueil/chef-equipe";

const JOUR = "2026-10-23";
const base = { enTournee: false, enConge: false, enArret: false, planifie: false };

describe("état du jour d'un membre", () => {
  it("priorité : arrêt, congé, tournée en cours, disponible, non planifié", () => {
    expect(etatMembre({ ...base, enArret: true, enConge: true, enTournee: true, planifie: true })).toBe("arret");
    expect(etatMembre({ ...base, enConge: true, enTournee: true, planifie: true })).toBe("conge");
    expect(etatMembre({ ...base, enTournee: true, planifie: true })).toBe("en_tournee");
    expect(etatMembre({ ...base, planifie: true })).toBe("disponible");
    expect(etatMembre(base)).toBe("non_planifie");
  });
});

describe("équipe du jour", () => {
  const membres = [
    { id: "a", full_name: "Alice", role: "chauffeur" },
    { id: "b", full_name: "Bruno", role: "chauffeur" },
    { id: "c", full_name: "Chloé", role: "chauffeur" },
    { id: "d", full_name: "David", role: "chauffeur" },
    { id: "e", full_name: "Emma", role: "manager" },
    { id: "a", full_name: "Alice (doublon)", role: "chauffeur" },
  ];
  const equipe = construireEquipe({
    membres,
    entrees: [
      { driver_id: "a", status: "in_progress", tour_number: "T1", vehicles: { registration: "AA-111-AA" } },
      { driver_id: "b", status: "planned", tour_number: "T2" },
      { driver_id: "c", status: "planned", tour_number: "T3" },
      { driver_id: "d", status: "cancelled", tour_number: "T4" },
    ],
    conges: [
      { driver_id: "c", start_date: "2026-10-20", end_date: "2026-10-25", status: "approved" },
      { driver_id: "b", start_date: "2026-10-23", end_date: "2026-10-23", status: "pending" },
    ],
    arrets: [
      { userId: "e", du: "2026-10-01", au: "2026-10-30", statut: "valide" },
      { userId: "d", du: "2026-10-01", au: "2026-10-30", statut: "refuse" },
    ],
    jour: JOUR,
  });
  const etat = (id: string) => equipe.find((m) => m.id === id)?.etat;

  it("calcule l'état de chacun (congé approuvé, arrêt non refusé, annulée ignorée)", () => {
    expect(etat("a")).toBe("en_tournee");
    expect(etat("b")).toBe("disponible"); // congé seulement demandé : ne compte pas
    expect(etat("c")).toBe("conge"); // le congé l'emporte sur l'affectation
    expect(etat("d")).toBe("non_planifie"); // arrêt refusé, affectation annulée
    expect(etat("e")).toBe("arret");
  });
  it("une personne n'apparaît qu'une fois, avec sa tournée et son véhicule", () => {
    expect(equipe).toHaveLength(5);
    const a = equipe.find((m) => m.id === "a")!;
    expect(a.nom).toBe("Alice");
    expect(a.tournee).toBe("T1");
    expect(a.immatriculation).toBe("AA-111-AA");
  });
  it("trie : en tournée, disponibles, non planifiés, puis absents", () => {
    expect(equipe.map((m) => m.etat)).toEqual(["en_tournee", "disponible", "non_planifie", "conge", "arret"]);
  });
  it("regroupe les compteurs", () => {
    const c = compterEquipe(equipe);
    expect(c).toEqual({ total: 5, enTournee: 1, disponibles: 1, absents: 2, nonPlanifies: 1 });
    expect(resumeEquipe(c)).toBe("1 en tournée · 1 disponible · 2 absents · 1 non planifié");
    expect(resumeEquipe({ total: 0, enTournee: 0, disponibles: 0, absents: 0, nonPlanifies: 0 })).toBe("0 en tournée · 0 disponible · 0 absent");
  });
  it("ignore les tournées de présence dans le libellé de tournée", () => {
    const e = construireEquipe({ membres: [membres[0]!], entrees: [{ driver_id: "a", status: "presence", tour_number: "PRESENCE-1" }], conges: [], arrets: [], jour: JOUR });
    expect(e[0]).toMatchObject({ etat: "disponible", tournee: null });
  });
});

describe("véhicules du service", () => {
  const v = (id: string, status = "active") => ({ id, registration: `IM-${id}`, type: "VL", status });
  const liste = construireVehicules({
    vehicules: [v("1"), v("2"), v("3"), v("4", "maintenance"), v("5", "out_of_service"), v("6")],
    tournees: [{ vehicle_id: "1", chauffeur: "Alice" }, { vehicle_id: "4", chauffeur: "Bruno" }],
    vehiculesEnIntervention: new Set(["3"]),
    documents: [
      { vehicle_id: "2", doc_type: "Contrôle technique", expires_on: "2026-11-10" },
      { vehicle_id: "6", doc_type: "Attestation d'assurance", expires_on: "2026-10-01" },
      { vehicle_id: "1", doc_type: "Carte grise", expires_on: "2027-12-01" },
    ],
    aujourdhui: JOUR,
  });
  const par = (id: string) => liste.find((x) => x.id === id)!;

  it("état : tournée avec chauffeur, entretien (statut ou intervention), hors service, disponible", () => {
    expect(par("1")).toMatchObject({ etat: "en_tournee", chauffeur: "Alice", asurveiller: false });
    expect(par("3").etat).toBe("entretien");
    expect(par("4").etat).toBe("entretien"); // l'entretien l'emporte sur la tournée
    expect(par("4").chauffeur).toBeNull();
    expect(par("5").etat).toBe("hors_service");
    expect(par("2").etat).toBe("disponible");
  });
  it("à surveiller : document expiré ou sous 30 jours, seulement si une échéance existe", () => {
    expect(par("2")).toMatchObject({ asurveiller: true, motif: "Contrôle technique à renouveler sous 30 jours" });
    expect(par("6")).toMatchObject({ asurveiller: true, motif: "Attestation d'assurance expiré" });
    expect(par("3").asurveiller).toBe(false);
    expect(motifSurveillance({ doc_type: "X", expires_on: null }, JOUR)).toBeNull();
    expect(motifSurveillance({ doc_type: "X", expires_on: "2027-01-01" }, JOUR)).toBeNull();
  });
  it("les véhicules à surveiller passent en premier ; compteurs", () => {
    expect(liste.slice(0, 2).every((x) => x.asurveiller)).toBe(true);
    expect(compterVehicules(liste)).toEqual({ total: 6, enTournee: 1, disponibles: 2, entretien: 2, asurveiller: 2 });
  });
});

describe("ancienneté", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  it("jours écoulés et libellé", () => {
    expect(ancienneteJours("2026-10-23T08:00:00Z", now)).toBe(0);
    expect(ancienneteJours("2026-10-18", now)).toBe(5);
    expect(ancienneteJours("2026-12-01", now)).toBe(0);
    expect(ancienneteJours(null, now)).toBeNull();
    expect(ancienneteJours("pas une date", now)).toBeNull();
    expect(libelleAnciennete(0)).toBe("aujourd'hui");
    expect(libelleAnciennete(1)).toBe("hier");
    expect(libelleAnciennete(5)).toBe("il y a 5 jours");
    expect(libelleAnciennete(21)).toBe("il y a 3 semaines");
    expect(libelleAnciennete(90)).toBe("il y a 3 mois");
    expect(libelleAnciennete(null)).toBe("");
  });
  it("les plus anciens d'abord, sans date en dernier", () => {
    const l = trierParAnciennete([{ date: "2026-10-02" }, { date: null }, { date: "2026-09-01" }]);
    expect(l.map((x) => x.date)).toEqual(["2026-09-01", "2026-10-02", null]);
  });
});

describe("hiérarchie : le manager ne décide pas ce qui le concerne", () => {
  const moi = { id: "m1", role: "manager", serviceIds: ["s1"] };
  it("sa propre amende : renvoyée au niveau supérieur", () => {
    const m = mentionHierarchie({ moi, dossier: { personneId: "m1", personneRole: "manager" } });
    expect(m).toContain("exploitation ou la direction");
  });
  it("un autre manager : même règle ; un chauffeur de son service : il décide", () => {
    expect(mentionHierarchie({ moi, dossier: { personneId: "m2", personneRole: "manager", personneServiceIds: ["s1"] } })).not.toBeNull();
    expect(mentionHierarchie({ moi, dossier: { personneId: "c1", personneRole: "chauffeur", personneServiceIds: ["s1"] } })).toBeNull();
  });
  it("chauffeur d'un autre service : pas de décision pour lui", () => {
    expect(mentionHierarchie({ moi, dossier: { personneId: "c9", personneRole: "chauffeur", personneServiceIds: ["s9"] } })).not.toBeNull();
  });
  it("personne désignée inconnue : aucune mention", () => {
    expect(mentionHierarchie({ moi, dossier: { personneId: null, personneRole: null } })).toBeNull();
  });
});

describe("utilitaires de liste", () => {
  it("fusionne sans doublon, la première lecture gagne", () => {
    expect(fusionner([{ id: "1", v: "a" }, { id: "2", v: "a" }], [{ id: "2", v: "b" }, { id: "3", v: "b" }])).toEqual([
      { id: "1", v: "a" },
      { id: "2", v: "a" },
      { id: "3", v: "b" },
    ]);
  });
  it("plafonne et indique le reste", () => {
    expect(plafonner([1, 2, 3, 4], 3)).toEqual({ vus: [1, 2, 3], reste: 1 });
    expect(plafonner([1], 3)).toEqual({ vus: [1], reste: 0 });
  });
});

describe("écrans liés depuis l'accueil du manager", () => {
  const tout = new Set<string>(MODULES_AVEC_CODE);
  const ctx = { role: "manager" as const, modules: tout, conduit: false };
  it("équipe, flotte, amendes, contestations et notifications s'ouvrent pour un manager", () => {
    for (const id of ["equipe.utilisateurs", "equipe.utilisateur_fiche", "flotte.vehicules", "flotte.vehicule_fiche", "flotte.amendes", "exploitation.contestations", "communication.alertes"]) {
      expect(ecranOuvrable(id, ctx), id).toBe(true);
    }
  });
  it("sans le module Amendes ou Contestations, rien n'est proposé", () => {
    const sans = (m: string) => ({ ...ctx, modules: new Set([...tout].filter((x) => x !== m)) });
    expect(ecranOuvrable("flotte.amendes", sans("fines"))).toBe(false);
    expect(ecranOuvrable("exploitation.contestations", sans("customer_disputes"))).toBe(false);
  });
  it("la paie ne s'ouvre jamais pour un manager", () => {
    expect(ecranOuvrable("equipe.paie", ctx)).toBe(false);
  });
});
