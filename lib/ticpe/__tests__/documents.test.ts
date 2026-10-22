import { describe, expect, it } from "vitest";
import { BAREME_PAR_DEFAUT } from "@/lib/ticpe/bareme";
import { eligibiliteVehicule } from "@/lib/ticpe/eligibilite";
import { appliquerPlafond, calculerPlein, type PleinTicpe } from "@/lib/ticpe/montant";
import { REGLAGES_PAR_DEFAUT } from "@/lib/ticpe/reglages";
import { documentPeriode, etatRecapitulatifAnnuel, nomFichierSur, type InfosVehiculeDoc } from "@/lib/ticpe/documents";

const elig = eligibiliteVehicule({ type: "PL", ptac_kg: 19000, fuel_type: "Diesel" }, { reglages: REGLAGES_PAR_DEFAUT, aCarteGrise: true });
const vehicules = new Map<string, InfosVehiculeDoc>([
  ["v1", { registration: "AA-001-AA", type: "PL", ptac_kg: 19000, cg_genre: "CAM", cg_energie: "GO", cg_premiere_immat: "2021-03-15", ownership: "propre", eligibilite: elig }],
  ["v2", { registration: "BB-002-BB", type: "SPL", ptac_kg: "44000", fuel_type: "Diesel", ownership: "location", eligibilite: elig }],
]);
const ctx = { eligibilite: elig, reglages: REGLAGES_PAR_DEFAUT, bareme: BAREME_PAR_DEFAUT, surcharges: [] };
const p = (x: Partial<PleinTicpe> & { id: string }) =>
  calculerPlein({ vehicle_id: "v1", occurred_at: "2026-03-10T08:00:00Z", liters: 100, status: "validated", product: "gazole", ticket_photo_path: "t", ...x }, ctx);
const { lignes } = appliquerPlafond(
  [
    p({ id: "a" }),
    p({ id: "b", station_name: "Bastia", liters: 200 }),
    p({ id: "c", vehicle_id: "v2", occurred_at: "2026-05-02T08:00:00Z", liters: 600 }),
    p({ id: "d", vehicle_id: "v2", occurred_at: "2026-06-02T08:00:00Z", liters: 600 }),
    p({ id: "e", occurred_at: "2025-12-31T08:00:00Z", liters: 50 }),
    p({ id: "f", product: "adblue" }),
  ],
  1000,
  "annuel",
);

describe("récapitulatif de période (3310-TIC)", () => {
  it("totaux, hectolitres retenus et détail par véhicule", () => {
    const d = documentPeriode(lignes, vehicules, "2026-01-01", "2026-06-30");
    expect(d).toMatchObject({ totalLitres: 1500, totalLitresRetenus: 1300, totalHectolitres: 13, tauxManquants: 0 });
    expect(d.totalMontant).toBe(Math.round((100 * 0.1556 + 200 * 0.1421 + 1000 * 0.1556) * 100) / 100);
    expect(d.recap.map((r) => [r.zone, r.hectolitres])).toEqual([
      ["corse", 2],
      ["metropole", 11],
    ]);
    expect(d.vehicules.map((v) => [v.registration, v.litresRetenus, v.litresHorsPlafond, v.ptacKg])).toEqual([
      ["AA-001-AA", 300, 0, 19000],
      ["BB-002-BB", 1000, 200, 44000],
    ]);
  });
});

describe("état récapitulatif annuel (ERA)", () => {
  it("une ligne par véhicule, infos véhicule, détail par usage, produit et zone", () => {
    const era = etatRecapitulatifAnnuel(lignes, vehicules, 2026);
    expect(era).toHaveLength(2);
    expect(era[0]).toMatchObject({
      registration: "AA-001-AA",
      genre: "CAM",
      energie: "GO",
      premiereImmat: "2021-03-15",
      detention: "En propre",
      categorie: "Marchandises",
      litresAcquis: 300,
      litresRetenus: 300,
    });
    expect(era[0]!.details).toEqual([
      { usage: "Marchandises", produit: "Gazole", zone: "Métropole hors Corse", taux: 15.56, litres: 100, montant: 15.56 },
      { usage: "Marchandises", produit: "Gazole", zone: "Corse", taux: 14.21, litres: 200, montant: 28.42 },
    ]);
    expect(era[1]).toMatchObject({ detention: "Location", litresAcquis: 1200, litresHorsPlafond: 200, energie: "Diesel" });
  });
  it("année sans plein : vide ; 2025 isolée", () => {
    expect(etatRecapitulatifAnnuel(lignes, vehicules, 2024)).toEqual([]);
    expect(etatRecapitulatifAnnuel(lignes, vehicules, 2025)[0]).toMatchObject({ litresAcquis: 50 });
  });
});

describe("noms de fichiers", () => {
  it("sans accents ni séparateurs", () => {
    expect(nomFichierSur("Carte grise AB-123-CD.pdf")).toBe("Carte_grise_AB-123-CD.pdf");
    expect(nomFichierSur("été/../x")).toBe("ete_.._x");
    expect(nomFichierSur("///")).toBe("fichier");
  });
});
