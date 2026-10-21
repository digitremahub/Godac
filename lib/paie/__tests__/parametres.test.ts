import { describe, expect, it } from "vitest";
import { PARAMETRES, PARAMETRES_A_JOUR_JUSQUAU, parametresLegauxAu, versionParametres } from "../parametres";

describe("paramètres légaux versionnés par date d'effet", () => {
  it("chaque bulletin prend la version en vigueur au 1er jour de son mois", () => {
    expect(parametresLegauxAu("2026-03-01").effetAu).toBe("2026-01-01");
    expect(parametresLegauxAu("2026-05-01").effetAu).toBe("2026-05-01");
    expect(parametresLegauxAu("2026-05-31").smicHoraire).toBe(12.02);
    expect(parametresLegauxAu("2026-06-01").smicHoraire).toBe(12.31);
    expect(versionParametres("2026-09-01")).toMatchObject({ effetAu: "2026-06-01", libelle: "SMIC du 1er juin 2026", aJour: true });
  });
  it("versions passées en paramètre : la plus récente antérieure à la date", () => {
    const v = [{ ...PARAMETRES[0]!, effetAu: "2027-01-01", smicHoraire: 99 }, ...PARAMETRES];
    expect(parametresLegauxAu("2027-02-01", v).smicHoraire).toBe(99);
    expect(parametresLegauxAu("2026-12-01", v).smicHoraire).toBe(12.31);
  });
  it("versions triées de la plus récente à la plus ancienne", () => {
    const dates = PARAMETRES.map((p) => p.effetAu);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
  it("garde-fou : les paramètres couvrent le mois prochain (sinon, ajouter la version de l'année suivante)", () => {
    const d = new Date();
    const moisProchain = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)).toISOString().slice(0, 10);
    expect(moisProchain <= PARAMETRES_A_JOUR_JUSQUAU, `Paramètres de paie à jour jusqu'au ${PARAMETRES_A_JOUR_JUSQUAU} seulement : ajoutez la version suivante dans lib/paie/parametres.ts.`).toBe(true);
  });
});
