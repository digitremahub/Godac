import { describe, expect, it } from "vitest";
import {
  aRegulariser,
  categorieVehicule,
  classerEnergie,
  compteLe,
  dansPeriodeEligibilite,
  eligibiliteVehicule,
  type ContexteEligibilite,
  type VehiculeEligibilite,
} from "@/lib/ticpe/eligibilite";
import { differencesFiche, normaliserDate, normaliserImmatriculation, propositionDepuisCarteGrise, typePropose } from "@/lib/ticpe/carte-grise";
import { REGLAGES_PAR_DEFAUT } from "@/lib/ticpe/reglages";

const ctx: ContexteEligibilite = { reglages: REGLAGES_PAR_DEFAUT, aCarteGrise: true };
const camion: VehiculeEligibilite = { type: "PL", ptac_kg: 19000, fuel_type: "Diesel", ownership: "propre" };
const codes = (v: VehiculeEligibilite, c: ContexteEligibilite = ctx) => eligibiliteVehicule(v, c).raisons.map((r) => r.code);

describe("éligibilité d'un véhicule", () => {
  it("camion gazole de 19 t, carte grise jointe : éligible sans raison", () => {
    expect(eligibiliteVehicule(camion, ctx)).toEqual({ statut: "eligible", raisons: [], categorie: "trm", periode: { debut: null, fin: null } });
  });
  it("SPL de 44 t (PTAC en texte)", () => {
    expect(eligibiliteVehicule({ ...camion, type: "SPL", ptac_kg: "44000" }, ctx).statut).toBe("eligible");
  });
  it("VL / VUL : exclu", () => {
    const r = eligibiliteVehicule({ ...camion, type: "VL", ptac_kg: 3500 }, ctx);
    expect(r.statut).toBe("exclu");
    expect(r.raisons[0]?.code).toBe("vehicule_leger");
  });
  it("PTAC < 7,5 t : exclu ; exactement 7,5 t : éligible", () => {
    expect(codes({ ...camion, ptac_kg: 7490 })).toContain("ptac_insuffisant");
    expect(eligibiliteVehicule({ ...camion, ptac_kg: 7500 }, ctx).statut).toBe("eligible");
  });
  it("PTAC inconnu : à vérifier", () => {
    const r = eligibiliteVehicule({ ...camion, ptac_kg: null }, ctx);
    expect(r.statut).toBe("a_verifier");
    expect(r.raisons.map((x) => x.code)).toEqual(["ptac_inconnu"]);
  });
  it("PTAC estimé par l'IA non confirmé : à vérifier", () => {
    expect(codes({ ...camion, spec_sources: { ptac_kg: { origin: "ia", confirmed: false } } })).toEqual(["ptac_ia"]);
    expect(codes({ ...camion, spec_sources: { ptac_kg: { origin: "ia", confirmed: true } } })).toEqual([]);
  });
  it("type estimé par l'IA non confirmé : exclu (règle historique) mais à régulariser", () => {
    const r = eligibiliteVehicule({ ...camion, spec_sources: { type: { origin: "ia", confirmed: false } } }, ctx);
    expect(r.statut).toBe("exclu");
    expect(aRegulariser(r)).toBe(true);
  });
  it("énergies exclues", () => {
    for (const f of ["Essence", "Électrique", "GNV", "GPL", "Hydrogène", "E85"]) {
      expect(eligibiliteVehicule({ ...camion, fuel_type: f }, ctx).statut, f).toBe("exclu");
    }
  });
  it("énergie inconnue : à vérifier", () => {
    expect(codes({ ...camion, fuel_type: null })).toEqual(["energie_inconnue"]);
  });
  it("HVO / B100 : exclu par défaut, à vérifier si accepté", () => {
    expect(eligibiliteVehicule({ ...camion, fuel_type: "HVO100" }, ctx).statut).toBe("exclu");
    expect(eligibiliteVehicule({ ...camion, fuel_type: "B100" }, ctx).statut).toBe("exclu");
    const r = eligibiliteVehicule({ ...camion, fuel_type: "HVO" }, { ...ctx, reglages: { ...REGLAGES_PAR_DEFAUT, accepte_hvo_b100: true } });
    expect(r.statut).toBe("a_verifier");
  });
  it("hybride gazole : à vérifier", () => {
    expect(codes({ ...camion, fuel_type: "Hybride diesel" })).toEqual(["energie_hybride"]);
  });
  it("immatriculation hors UE : exclu ; UE : éligible", () => {
    expect(codes({ ...camion, pays_immatriculation: "CH" })).toContain("immatriculation_hors_ue");
    expect(eligibiliteVehicule({ ...camion, pays_immatriculation: "es" }, ctx).statut).toBe("eligible");
  });
  it("carte grise manquante : à vérifier", () => {
    expect(eligibiliteVehicule(camion, { ...ctx, aCarteGrise: false })).toMatchObject({ statut: "a_verifier" });
    expect(codes(camion, { ...ctx, aCarteGrise: false })).toEqual(["carte_grise_manquante"]);
  });
  it("genre léger sur la carte grise d'un PL : à vérifier", () => {
    expect(codes({ ...camion, cg_genre: "CTTE" })).toEqual(["carte_grise_incoherente"]);
    expect(codes({ ...camion, cg_genre: "CAM" })).toEqual([]);
  });
  it("location : réglage organisation « nous » → à vérifier ; fiche « nous » → info ; « loueur » → exclu", () => {
    const loue = { ...camion, ownership: "location", rental_start_date: "2026-02-01", rental_end_date: "2026-08-31" };
    expect(eligibiliteVehicule(loue, ctx).statut).toBe("a_verifier");
    expect(eligibiliteVehicule({ ...loue, ticpe_location_demandeur: "nous" }, ctx)).toMatchObject({ statut: "eligible", raisons: [{ code: "location_nous", gravite: "info" }] });
    expect(eligibiliteVehicule({ ...loue, ticpe_location_demandeur: "loueur" }, ctx).statut).toBe("exclu");
    expect(eligibiliteVehicule(loue, { ...ctx, reglages: { ...REGLAGES_PAR_DEFAUT, location_demandeur: "loueur" } }).statut).toBe("exclu");
    // La fiche l'emporte sur le réglage de l'organisation.
    expect(eligibiliteVehicule({ ...loue, ticpe_location_demandeur: "nous" }, { ...ctx, reglages: { ...REGLAGES_PAR_DEFAUT, location_demandeur: "loueur" } }).statut).toBe("eligible");
  });
  it("crédit-bail et LLD comptent comme location", () => {
    expect(codes({ ...camion, ownership: "credit_bail" })).toContain("location_a_confirmer");
    expect(codes({ ...camion, ownership: "location_longue_duree" })).toContain("location_a_confirmer");
  });
  it("catégorie : écarté à la main", () => {
    const r = eligibiliteVehicule({ ...camion, ticpe_categorie: "exclu" }, ctx);
    expect(r).toMatchObject({ statut: "exclu", categorie: null });
  });
  it("taxi : désactivé par défaut ; activé, un VL est admis", () => {
    const taxi = { ...camion, type: "VL" as const, ptac_kg: 2000, ticpe_categorie: "taxi" };
    expect(codes(taxi)).toContain("activite_inactive");
    const r = eligibiliteVehicule(taxi, { ...ctx, reglages: { ...REGLAGES_PAR_DEFAUT, activite_taxi: true } });
    expect(r).toMatchObject({ statut: "eligible", categorie: "taxi" });
  });
  it("taxi poids lourd : à vérifier", () => {
    expect(codes({ ...camion, ticpe_categorie: "taxi" }, { ...ctx, reglages: { ...REGLAGES_PAR_DEFAUT, activite_taxi: true } })).toEqual(["taxi_lourd"]);
  });
  it("voyageurs (autocar) : pas de seuil de PTAC, activité requise", () => {
    const car = { ...camion, ptac_kg: 5000, ticpe_categorie: "trv" };
    expect(codes(car)).toEqual(["activite_inactive"]);
    expect(eligibiliteVehicule(car, { ...ctx, reglages: { ...REGLAGES_PAR_DEFAUT, activite_trv: true } }).statut).toBe("eligible");
  });
  it("plusieurs raisons : la plus grave décide", () => {
    const r = eligibiliteVehicule({ ...camion, ptac_kg: null, fuel_type: "Essence" }, { ...ctx, aCarteGrise: false });
    expect(r.statut).toBe("exclu");
    expect(r.raisons.map((x) => x.code)).toEqual(["ptac_inconnu", "energie_exclue", "carte_grise_manquante"]);
    expect(aRegulariser(r)).toBe(false);
  });
});

describe("période d'éligibilité", () => {
  it("entrée et sortie de flotte", () => {
    const r = eligibiliteVehicule({ ...camion, flotte_entree_le: "2026-03-10", flotte_sortie_le: "2026-09-30" }, ctx);
    expect(r.periode).toEqual({ debut: "2026-03-10", fin: "2026-09-30" });
    expect(compteLe(r, "2026-03-09T22:00:00Z")).toBe(false);
    expect(compteLe(r, "2026-03-10")).toBe(true);
    expect(compteLe(r, "2026-09-30")).toBe(true);
    expect(compteLe(r, "2026-10-01")).toBe(false);
  });
  it("location : la plus restrictive des bornes", () => {
    const r = eligibiliteVehicule(
      { ...camion, ownership: "location", ticpe_location_demandeur: "nous", rental_start_date: "2026-04-01", rental_end_date: "2026-12-31", flotte_entree_le: "2026-03-15", flotte_sortie_le: "2026-10-31" },
      ctx,
    );
    expect(r.periode).toEqual({ debut: "2026-04-01", fin: "2026-10-31" });
  });
  it("dates de location ignorées pour un véhicule en propre", () => {
    const r = eligibiliteVehicule({ ...camion, rental_start_date: "2026-04-01" }, ctx);
    expect(r.periode).toEqual({ debut: null, fin: null });
  });
  it("un véhicule exclu ne compte jamais", () => {
    expect(compteLe(eligibiliteVehicule({ ...camion, type: "VL" }, ctx), "2026-05-01")).toBe(false);
  });
  it("à vérifier : compte", () => {
    expect(compteLe(eligibiliteVehicule({ ...camion, ptac_kg: null }, ctx), "2026-05-01")).toBe(true);
  });
  it("dansPeriodeEligibilite sans bornes", () => {
    expect(dansPeriodeEligibilite({ debut: null, fin: null }, "2020-01-01")).toBe(true);
  });
});

describe("énergie", () => {
  it("texte libre", () => {
    expect(classerEnergie("Diesel")).toBe("gazole");
    expect(classerEnergie("gazole")).toBe("gazole");
    expect(classerEnergie("Gasoil")).toBe("gazole");
    expect(classerEnergie("SP95")).toBe("exclu");
    expect(classerEnergie("Hybride essence")).toBe("exclu");
    expect(classerEnergie("HVO100")).toBe("hvo_b100");
    expect(classerEnergie("")).toBe("inconnu");
    expect(classerEnergie("autre")).toBe("inconnu");
  });
  it("code P.3 de la carte grise", () => {
    expect(classerEnergie(null, "GO")).toBe("gazole");
    expect(classerEnergie("Électrique", "GO")).toBe("gazole");
    expect(classerEnergie(null, "ES")).toBe("exclu");
    expect(classerEnergie(null, "EL")).toBe("exclu");
    expect(classerEnergie(null, "GH")).toBe("hybride");
    expect(classerEnergie("HVO", "GO")).toBe("hvo_b100");
  });
  it("catégorie par défaut de l'organisation", () => {
    expect(categorieVehicule({ ticpe_categorie: null }, REGLAGES_PAR_DEFAUT)).toBe("trm");
    expect(categorieVehicule({ ticpe_categorie: "trv" }, REGLAGES_PAR_DEFAUT)).toBe("trv");
    expect(categorieVehicule({ ticpe_categorie: "bidon" }, REGLAGES_PAR_DEFAUT)).toBe("trm");
  });
});

describe("carte grise", () => {
  it("proposition à partir d'une lecture", () => {
    const p = propositionDepuisCarteGrise({ immatriculation: "ab 123 cd", date_premiere_immat: "15/03/2021", marque: "MARQUE", genre: "cam", ptac_kg: 19000, energie: "go" });
    expect(p).toEqual({
      registration: "AB-123-CD",
      type: "PL",
      ptac_kg: 19000,
      fuel_type: "Gazole",
      cg_genre: "CAM",
      cg_energie: "GO",
      cg_premiere_immat: "2021-03-15",
      brand: "MARQUE",
    });
  });
  it("tracteur routier → SPL ; VP → VL ; sans genre, le PTAC décide", () => {
    expect(typePropose("TRR", 44000)).toBe("SPL");
    expect(typePropose("VP", 1800)).toBe("VL");
    expect(typePropose("CTTE", 3500)).toBe("VL");
    expect(typePropose("CAM", 3500)).toBe("VL");
    expect(typePropose(null, 12000)).toBe("PL");
    expect(typePropose(null, null)).toBeNull();
  });
  it("valeurs illisibles ignorées", () => {
    const p = propositionDepuisCarteGrise({ immatriculation: null, date_premiere_immat: "31/02/2021", marque: " ", genre: null, ptac_kg: -3, energie: null });
    expect(p).toMatchObject({ registration: null, cg_premiere_immat: null, ptac_kg: null, brand: null, fuel_type: null });
  });
  it("normalisations", () => {
    expect(normaliserImmatriculation("AB123CD")).toBe("AB-123-CD");
    expect(normaliserImmatriculation("123 ABC 75")).toBe("123ABC75");
    expect(normaliserDate("2021-03-15")).toBe("2021-03-15");
    expect(normaliserDate("1.2.2020")).toBe("2020-02-01");
    expect(normaliserDate("hier")).toBeNull();
  });
  it("différences avec la fiche", () => {
    const p = propositionDepuisCarteGrise({ immatriculation: "AB-123-CD", date_premiere_immat: null, marque: null, genre: "TRR", ptac_kg: 44000, energie: "GO" });
    expect(differencesFiche({ registration: "AB123CD", type: "PL", ptac_kg: "40000" }, p)).toEqual(["Type : fiche PL, carte grise SPL", "PTAC : fiche 40000 kg, carte grise 44000 kg"]);
  });
});
