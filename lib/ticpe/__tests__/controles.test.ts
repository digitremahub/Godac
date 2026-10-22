import { describe, expect, it } from "vitest";
import { BAREME_PAR_DEFAUT } from "@/lib/ticpe/bareme";
import { compterParGravite, controlesPeriode, doublonsProbables, litresProches, type PleinControle, type VehiculeControle } from "@/lib/ticpe/controles";
import { eligibiliteVehicule, type VehiculeEligibilite } from "@/lib/ticpe/eligibilite";
import { appliquerPlafond, calculerPlein, type PleinTicpe } from "@/lib/ticpe/montant";
import { REGLAGES_PAR_DEFAUT, type ReglagesTicpe } from "@/lib/ticpe/reglages";

const camion: VehiculeEligibilite = { type: "PL", ptac_kg: 19000, fuel_type: "Diesel" };

function scenario(
  pleins: (Partial<PleinTicpe> & { id: string })[],
  vehicules: Record<string, VehiculeEligibilite & { registration?: string; tank_capacity_liters?: number }> = { v1: camion },
  opts: { reglages?: ReglagesTicpe; aCarteGrise?: boolean; anomalies?: string[]; plafond?: number } = {},
) {
  const reglages = opts.reglages ?? REGLAGES_PAR_DEFAUT;
  const vmap = new Map<string, VehiculeControle>();
  for (const [id, v] of Object.entries(vehicules)) {
    vmap.set(id, { registration: v.registration ?? id.toUpperCase(), tank_capacity_liters: v.tank_capacity_liters, eligibilite: eligibiliteVehicule(v, { reglages, aCarteGrise: opts.aCarteGrise ?? true }) });
  }
  const complets: PleinTicpe[] = pleins.map((p) => ({ vehicle_id: "v1", occurred_at: "2026-03-10T08:00:00Z", liters: 300, status: "validated", product: "gazole", ticket_photo_path: "t.jpg", ...p }));
  const brutes = complets.map((p) => calculerPlein(p, { eligibilite: vmap.get(p.vehicle_id)?.eligibilite ?? null, reglages, bareme: BAREME_PAR_DEFAUT, surcharges: [] }));
  const { lignes, depassements } = appliquerPlafond(brutes, opts.plafond ?? reglages.plafond_litres, reglages.plafond_periode);
  return controlesPeriode({
    periode: { debut: "2026-03-01", fin: "2026-03-31" },
    lignes,
    pleins: new Map(complets.map((p) => [p.id, p as PleinControle])),
    vehicules: vmap,
    depassements,
    anomaliesConsommation: new Set(opts.anomalies ?? []),
  });
}
const codes = (pts: { code: string }[]) => pts.map((p) => p.code).sort();

describe("contrôles avant déclaration", () => {
  it("plein propre : rien à régler", () => {
    expect(scenario([{ id: "a" }])).toEqual([]);
  });
  it("plein non validé d'un véhicule éligible : bloquant, lien vers le plein", () => {
    const p = scenario([{ id: "a", status: "awaiting_validation" }]);
    expect(p).toMatchObject([{ code: "plein_non_valide", gravite: "bloquant", lien: "/carburant/pleins?plein=a", objet: { type: "plein", id: "a" } }]);
  });
  it("plein non validé d'un VL : ignoré", () => {
    expect(scenario([{ id: "a", status: "awaiting_validation" }], { v1: { type: "VL" } })).toEqual([]);
  });
  it("plein en station sans justificatif : bloquant ; relevé de carte déclaré : ok", () => {
    expect(scenario([{ id: "a", ticket_photo_path: null }])[0]).toMatchObject({ code: "sans_justificatif", gravite: "bloquant" });
    expect(scenario([{ id: "a", ticket_photo_path: null, ticpe_justificatif: "releve_carte" }])).toEqual([]);
  });
  it("plein à la cuve sans facture de livraison : avertissement", () => {
    expect(scenario([{ id: "a", ticket_photo_path: null, tank_id: "t" }])[0]).toMatchObject({ code: "cuve_sans_facture", gravite: "avertissement" });
  });
  it("litres au-delà du réservoir", () => {
    expect(codes(scenario([{ id: "a", liters: 500 }], { v1: { ...camion, tank_capacity_liters: 400 } }))).toEqual(["litres_reservoir"]);
  });
  it("consommation anormale (écart carburant existant)", () => {
    expect(codes(scenario([{ id: "a" }], undefined, { anomalies: ["a"] }))).toEqual(["consommation"]);
  });
  it("doublon probable : même véhicule, 20 minutes, litres proches", () => {
    const p = scenario([
      { id: "a", occurred_at: "2026-03-10T08:00:00Z", liters: 300 },
      { id: "b", occurred_at: "2026-03-10T08:20:00Z", liters: 302 },
    ]);
    expect(p).toMatchObject([{ code: "doublon", gravite: "bloquant", objet: { id: "b" } }]);
  });
  it("PTAC inconnu : bloquant sur le véhicule", () => {
    const p = scenario([{ id: "a" }, { id: "b", occurred_at: "2026-03-12T08:00:00Z" }], { v1: { ...camion, ptac_kg: null } });
    expect(p).toMatchObject([{ code: "ptac_inconnu", gravite: "bloquant", lien: "/flotte/vehicules/v1" }]);
  });
  it("hors période d'éligibilité", () => {
    expect(codes(scenario([{ id: "a" }], { v1: { ...camion, flotte_sortie_le: "2026-03-01" } }))).toEqual(["hors_periode"]);
  });
  it("plafond dépassé : avertissement", () => {
    const p = scenario([{ id: "a", liters: 300 }, { id: "b", occurred_at: "2026-03-20T08:00:00Z", liters: 300 }], undefined, { plafond: 500 });
    expect(p).toMatchObject([{ code: "plafond", gravite: "avertissement" }]);
    expect(p[0]!.detail).toContain("100 L exclus");
  });
  it("taux manquant : un point par activité et zone", () => {
    const reglages = { ...REGLAGES_PAR_DEFAUT, activite_taxi: true };
    const p = scenario([{ id: "a" }, { id: "b", occurred_at: "2026-03-15T08:00:00Z" }], { v1: { type: "VL", fuel_type: "Diesel", ticpe_categorie: "taxi" } }, { reglages });
    expect(p).toMatchObject([{ code: "taux_manquant", gravite: "bloquant", lien: "/carburant/ticpe/reglages" }]);
    expect(p[0]!.detail).toContain("2 plein(s)");
  });
  it("véhicule loué, remboursement demandé par le loueur", () => {
    expect(codes(scenario([{ id: "a" }], { v1: { ...camion, ownership: "location", ticpe_location_demandeur: "loueur" } }))).toEqual(["location_loueur"]);
  });
  it("véhicule loué à confirmer, carte grise manquante : avertissements véhicule", () => {
    const p = scenario([{ id: "a" }], { v1: { ...camion, ownership: "location" } }, { aCarteGrise: false });
    expect(codes(p)).toEqual(["vehicule_a_verifier", "vehicule_a_verifier"]);
  });
  it("type IA non confirmé : pleins non comptés, à régulariser", () => {
    expect(codes(scenario([{ id: "a" }], { v1: { ...camion, spec_sources: { type: { origin: "ia", confirmed: false } } } }))).toEqual(["vehicule_a_regulariser"]);
  });
  it("hors de la période contrôlée : ignoré ; bloquants d'abord", () => {
    expect(scenario([{ id: "a", status: "awaiting_validation", occurred_at: "2026-04-02T08:00:00Z" }])).toEqual([]);
    const p = scenario([{ id: "a", liters: 500, ticket_photo_path: null }], { v1: { ...camion, tank_capacity_liters: 400 } });
    expect(p.map((x) => x.gravite)).toEqual(["bloquant", "avertissement"]);
    expect(compterParGravite(p)).toEqual({ bloquants: 1, avertissements: 1 });
  });
});

describe("doublons", () => {
  const p = (id: string, vehicle_id: string, occurred_at: string, liters: number) => ({ id, vehicle_id, occurred_at, liters });
  it("limites : 30 minutes, 1 L ou 2 %", () => {
    expect(doublonsProbables([p("a", "v", "2026-01-01T08:00:00Z", 100), p("b", "v", "2026-01-01T08:30:00Z", 101)])).toHaveLength(1);
    expect(doublonsProbables([p("a", "v", "2026-01-01T08:00:00Z", 100), p("b", "v", "2026-01-01T08:31:00Z", 100)])).toHaveLength(0);
    expect(doublonsProbables([p("a", "v", "2026-01-01T08:00:00Z", 100), p("b", "v", "2026-01-01T08:10:00Z", 103)])).toHaveLength(0);
    expect(doublonsProbables([p("a", "v", "2026-01-01T08:00:00Z", 100), p("b", "w", "2026-01-01T08:10:00Z", 100)])).toHaveLength(0);
  });
  it("litres proches", () => {
    expect(litresProches(500, 509)).toBe(true);
    expect(litresProches(500, 511)).toBe(false);
    expect(litresProches(20, 21)).toBe(true);
  });
});
