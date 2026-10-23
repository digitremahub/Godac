import { describe, expect, it } from "vitest";
import { BAREME_PAR_DEFAUT } from "@/lib/ticpe/bareme";
import { eligibiliteVehicule, type ResultatEligibilite } from "@/lib/ticpe/eligibilite";
import {
  appliquerPlafond,
  calculerPlein,
  clePeriodePlafond,
  jourParis,
  justificatifDuPlein,
  libelleLigne,
  lignesDeLaPeriode,
  stationEnCorse,
  totaliser,
  zoneDuPlein,
  type ContextePlein,
  type PleinTicpe,
} from "@/lib/ticpe/montant";
import { REGLAGES_PAR_DEFAUT, plafondEffectif } from "@/lib/ticpe/reglages";

const elig: ResultatEligibilite = eligibiliteVehicule({ type: "PL", ptac_kg: 19000, fuel_type: "Diesel" }, { reglages: REGLAGES_PAR_DEFAUT, aCarteGrise: true });
const ctx: ContextePlein = { eligibilite: elig, reglages: REGLAGES_PAR_DEFAUT, bareme: BAREME_PAR_DEFAUT, surcharges: [] };
const plein = (p: Partial<PleinTicpe> = {}): PleinTicpe => ({
  id: "p1",
  vehicle_id: "v1",
  occurred_at: "2026-03-10T08:00:00Z",
  liters: 400,
  status: "validated",
  product: "gazole",
  station_name: "Station du port",
  ticket_photo_path: "org/ticket.jpg",
  ...p,
});

describe("montant par plein", () => {
  it("plein de gazole validé, métropole 2026 : 400 L × 15,56 €/hl = 62,24 €", () => {
    const l = calculerPlein(plein(), ctx);
    expect(l).toMatchObject({ statut: "compte", zone: "metropole", taux: 15.56, montant: 62.24, litresRetenus: 400, categorie: "trm", origineTaux: "bareme" });
  });
  it("saisie manuelle comptée aussi", () => {
    expect(calculerPlein(plein({ status: "manual" }), ctx).statut).toBe("compte");
  });
  it("station en Corse : 14,21 €/hl", () => {
    expect(calculerPlein(plein({ station_name: "Relais Ajaccio" }), ctx)).toMatchObject({ zone: "corse", taux: 14.21, montant: 56.84, origineZone: "station" });
  });
  it("AdBlue, plein non validé, litres absents : exclus", () => {
    expect(calculerPlein(plein({ product: "adblue" }), ctx)).toMatchObject({ statut: "exclu", montant: 0 });
    expect(calculerPlein(plein({ status: "awaiting_validation" }), ctx).raison).toContain("non validé");
    expect(calculerPlein(plein({ liters: null }), ctx).statut).toBe("exclu");
  });
  it("véhicule exclu ou inconnu : exclu avec la raison", () => {
    const vl = eligibiliteVehicule({ type: "VL" }, { reglages: REGLAGES_PAR_DEFAUT, aCarteGrise: true });
    expect(calculerPlein(plein(), { ...ctx, eligibilite: vl }).raison).toContain("Véhicule léger");
    expect(calculerPlein(plein(), { ...ctx, eligibilite: null }).raison).toBe("Véhicule introuvable.");
  });
  it("hors période d'éligibilité (jour de Paris)", () => {
    const e = eligibiliteVehicule({ type: "PL", ptac_kg: 19000, fuel_type: "Diesel", flotte_entree_le: "2026-03-11" }, { reglages: REGLAGES_PAR_DEFAUT, aCarteGrise: true });
    expect(calculerPlein(plein({ occurred_at: "2026-03-10T23:30:00Z" }), { ...ctx, eligibilite: e }).statut).toBe("compte"); // 00 h 30 le 11/03 à Paris
    expect(calculerPlein(plein({ occurred_at: "2026-03-10T21:00:00Z" }), { ...ctx, eligibilite: e }).raison).toContain("hors de la période");
  });
  it("taux manquant (taxi) : signalé, montant 0", () => {
    const reglages = { ...REGLAGES_PAR_DEFAUT, activite_taxi: true };
    const taxi = eligibiliteVehicule({ type: "VL", fuel_type: "Diesel", ticpe_categorie: "taxi" }, { reglages, aCarteGrise: true });
    const l = calculerPlein(plein(), { ...ctx, reglages, eligibilite: taxi });
    expect(l).toMatchObject({ statut: "taux_manquant", montant: 0, litresRetenus: 400 });
    expect(libelleLigne(l)).toBe("taux manquant");
  });
  it("surcharge de l'organisation", () => {
    const l = calculerPlein(plein(), { ...ctx, surcharges: [{ categorie: "trm", zone: "metropole", date_debut: "2026-01-01", date_fin: null, taux_eur_hl: 10, motif: "x" }] });
    expect(l).toMatchObject({ taux: 10, montant: 40, origineTaux: "surcharge" });
  });
  it("2025 Île-de-France n'est pas déduite : taux métropole (zone par défaut)", () => {
    expect(calculerPlein(plein({ occurred_at: "2025-06-01T08:00:00Z" }), ctx)).toMatchObject({ taux: 15.56 });
    expect(calculerPlein(plein({ occurred_at: "2025-06-01T08:00:00Z" }), { ...ctx, reglages: { ...REGLAGES_PAR_DEFAUT, forfait_pondere_2025: true } })).toMatchObject({ taux: 15.71 });
  });
});

describe("zone et justificatif", () => {
  it("détection de la Corse", () => {
    for (const s of ["Station Bastia", "AJACCIO", "Total 20090", "Relais 2A", "Porto-Vecchio", "Corse"]) expect(stationEnCorse(s), s).toBe(true);
    for (const s of ["Lyon", "Paris 75012", "Station A20", "Calvisson", null]) expect(stationEnCorse(s), String(s)).toBe(false);
  });
  it("cuve : zone de la cuve, sinon zone par défaut", () => {
    expect(zoneDuPlein({ tank_id: "t", station_name: "Bastia" }, { zoneCuve: "metropole", zoneParDefaut: "metropole" })).toEqual({ zone: "metropole", origine: "cuve" });
    expect(zoneDuPlein({ tank_id: "t" }, { zoneCuve: "corse", zoneParDefaut: "metropole" })).toEqual({ zone: "corse", origine: "cuve" });
    expect(zoneDuPlein({ tank_id: "t" }, { zoneParDefaut: "corse" })).toEqual({ zone: "corse", origine: "defaut" });
    expect(zoneDuPlein({ station_name: "Lyon" }, { zoneParDefaut: "corse" })).toEqual({ zone: "corse", origine: "defaut" });
  });
  it("plein à la cuve : compte, justifié par les livraisons de la cuve", () => {
    const l = calculerPlein(plein({ tank_id: "t1", ticket_photo_path: null, station_name: null }), { ...ctx, zoneCuve: "corse", cuveAvecFacture: true });
    expect(l).toMatchObject({ statut: "compte", zone: "corse", justificatif: { type: "livraison_cuve", present: true } });
  });
  it("justificatifs", () => {
    expect(justificatifDuPlein(plein(), { cuveAvecFacture: false })).toMatchObject({ type: "ticket", present: true });
    expect(justificatifDuPlein(plein({ ticket_photo_path: null, ticpe_justificatif: "releve_carte", ticpe_justificatif_ref: "R-12" }), { cuveAvecFacture: false })).toMatchObject({
      type: "releve_carte",
      present: true,
      libelle: "Relevé de carte carburant n° R-12",
    });
    expect(justificatifDuPlein(plein({ ticket_photo_path: null }), { cuveAvecFacture: false })).toMatchObject({ type: null, present: false });
    expect(justificatifDuPlein(plein({ ticket_photo_path: null, tank_id: "t" }), { cuveAvecFacture: false })).toMatchObject({ type: "livraison_cuve", present: false });
  });
  it("jour de Paris", () => {
    expect(jourParis("2026-03-10T23:30:00Z")).toBe("2026-03-11");
    expect(jourParis("2026-07-31T21:59:00Z")).toBe("2026-07-31");
    expect(jourParis("2026-07-31T22:00:00Z")).toBe("2026-08-01");
  });
});

describe("plafond par véhicule", () => {
  const ligne = (id: string, jour: string, litres: number, vehicle_id = "v1") => calculerPlein(plein({ id, vehicle_id, occurred_at: `${jour}T08:00:00Z`, liters: litres }), ctx);

  it("les litres au-delà du plafond annuel sont exclus du montant mais visibles", () => {
    const { lignes, depassements } = appliquerPlafond([ligne("b", "2026-06-01", 300), ligne("a", "2026-01-15", 800), ligne("c", "2026-09-01", 500)], 1000, "annuel");
    expect(lignes.map((l) => [l.id, l.litresRetenus, l.litresHorsPlafond])).toEqual([
      ["b", 200, 100],
      ["a", 800, 0],
      ["c", 0, 500],
    ]);
    expect(lignes[0]!.montant).toBe(31.12);
    expect(lignes[2]!.montant).toBe(0);
    expect(depassements).toEqual([{ vehicle_id: "v1", periode: "2026", plafond: 1000, litres: 1600, litresHorsPlafond: 600 }]);
  });
  it("par véhicule et par année", () => {
    const { depassements } = appliquerPlafond([ligne("a", "2025-12-31", 900), ligne("b", "2026-01-01", 900), ligne("c", "2026-02-01", 900, "v2")], 1000, "annuel");
    expect(depassements).toEqual([]);
  });
  it("semestriel", () => {
    expect(clePeriodePlafond("2026-06-30", "semestriel")).toBe("2026-S1");
    expect(clePeriodePlafond("2026-07-01", "semestriel")).toBe("2026-S2");
    const { lignes } = appliquerPlafond([ligne("a", "2026-06-01", 600), ligne("b", "2026-07-01", 600)], 500, "semestriel");
    expect(lignes.map((l) => l.litresRetenus)).toEqual([500, 500]);
  });
  it("les pleins exclus ne consomment pas le plafond", () => {
    const ad = calculerPlein(plein({ id: "x", product: "adblue", liters: 5000 }), ctx);
    const { lignes } = appliquerPlafond([ad, ligne("a", "2026-05-01", 400)], 1000, "annuel");
    expect(lignes[1]!.litresRetenus).toBe(400);
    expect(lignes[0]!.litresRetenus).toBe(0);
  });
  it("aucun plafond par défaut : le scénario du tracteur à 45 000 L est compté en entier (7 002 €)", () => {
    expect(REGLAGES_PAR_DEFAUT).toMatchObject({ plafond_actif: false, plafond_litres: null });
    expect(plafondEffectif(REGLAGES_PAR_DEFAUT)).toBeNull();
    const l = Array.from({ length: 9 }, (_, i) => ligne(`p${i}`, `2026-0${1 + i}-10`, 5000));
    const { lignes, depassements } = appliquerPlafond(l, plafondEffectif(REGLAGES_PAR_DEFAUT), REGLAGES_PAR_DEFAUT.plafond_periode);
    expect(totaliser(lignes)).toMatchObject({ litres: 45000, litresRetenus: 45000, litresHorsPlafond: 0, montant: 7002 });
    expect(depassements).toEqual([]);
  });
  it("un plafond saisi mais non activé ne s'applique pas", () => {
    expect(plafondEffectif({ plafond_actif: false, plafond_litres: 40000 })).toBeNull();
    expect(plafondEffectif({ plafond_actif: true, plafond_litres: null })).toBeNull();
  });
  it("plafond explicitement activé : litres au-delà visibles, jamais perdus de vue", () => {
    const reglages = { ...REGLAGES_PAR_DEFAUT, plafond_actif: true, plafond_litres: 40000 };
    expect(plafondEffectif(reglages)).toBe(40000);
    const l = Array.from({ length: 41 }, (_, i) => ligne(`p${String(i).padStart(2, "0")}`, `2026-0${1 + (i % 9)}-10`, 1000));
    const { lignes, depassements } = appliquerPlafond(l, plafondEffectif(reglages), reglages.plafond_periode);
    expect(totaliser(lignes)).toMatchObject({ litres: 41000, litresRetenus: 40000, litresHorsPlafond: 1000, montant: 6224 });
    expect(depassements).toHaveLength(1);
  });
});

describe("totaux", () => {
  it("ignore les exclus, compte les taux manquants", () => {
    const reglages = { ...REGLAGES_PAR_DEFAUT, activite_taxi: true };
    const taxi = eligibiliteVehicule({ type: "VL", fuel_type: "Diesel", ticpe_categorie: "taxi" }, { reglages, aCarteGrise: true });
    const lignes = [calculerPlein(plein(), ctx), calculerPlein(plein({ id: "x", product: "adblue" }), ctx), calculerPlein(plein({ id: "t" }), { ...ctx, reglages, eligibilite: taxi })];
    expect(totaliser(lignes)).toEqual({ pleins: 2, litres: 800, litresRetenus: 800, litresHorsPlafond: 0, montant: 62.24, tauxManquants: 1 });
  });
  it("lignes de la période", () => {
    const l = [{ jour: "2026-01-31" }, { jour: "2026-02-01" }, { jour: "2026-02-28" }, { jour: "2026-03-01" }];
    expect(lignesDeLaPeriode(l, "2026-02-01", "2026-02-28")).toHaveLength(2);
  });
});
