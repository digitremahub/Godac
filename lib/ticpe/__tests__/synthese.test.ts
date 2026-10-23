import { describe, expect, it } from "vitest";
import { BAREME_PAR_DEFAUT } from "@/lib/ticpe/bareme";
import { eligibiliteVehicule } from "@/lib/ticpe/eligibilite";
import { calculerPlein, type PleinTicpe } from "@/lib/ticpe/montant";
import { REGLAGES_PAR_DEFAUT } from "@/lib/ticpe/reglages";
import { parMois, parVehicule, recapitulatif3310 } from "@/lib/ticpe/synthese";

const elig = eligibiliteVehicule({ type: "PL", ptac_kg: 19000, fuel_type: "Diesel" }, { reglages: REGLAGES_PAR_DEFAUT, aCarteGrise: true });
const ctx = { eligibilite: elig, reglages: REGLAGES_PAR_DEFAUT, bareme: BAREME_PAR_DEFAUT, surcharges: [] };
const l = (p: Partial<PleinTicpe> & { id: string }) =>
  calculerPlein({ vehicle_id: "v1", occurred_at: "2026-03-10T08:00:00Z", liters: 100, status: "validated", product: "gazole", ticket_photo_path: "x", ...p }, ctx);

const lignes = [
  l({ id: "a" }),
  l({ id: "b", vehicle_id: "v2", occurred_at: "2026-04-02T08:00:00Z", liters: 250 }),
  l({ id: "c", ticpe_zone: "corse", liters: 50 }),
  l({ id: "d", product: "adblue" }),
];

describe("synthèse", () => {
  it("par véhicule, exclus ignorés", () => {
    const m = parVehicule(lignes);
    expect(m.get("v1")).toMatchObject({ pleins: 2, litres: 150, montant: 22.67 });
    expect(m.get("v2")).toMatchObject({ pleins: 1, montant: 38.9 });
  });
  it("par mois", () => {
    expect([...parMois(lignes).keys()]).toEqual(["2026-03", "2026-04"]);
  });
  it("récapitulatif 3310-TIC : hectolitres et montant par activité, zone et taux", () => {
    expect(recapitulatif3310(lignes)).toEqual([
      { categorie: "trm", zone: "corse", taux: 14.21, pleins: 1, litres: 50, hectolitres: 0.5, montant: 7.11 },
      { categorie: "trm", zone: "metropole", taux: 15.56, pleins: 2, litres: 350, hectolitres: 3.5, montant: 54.46 },
    ]);
  });
});
