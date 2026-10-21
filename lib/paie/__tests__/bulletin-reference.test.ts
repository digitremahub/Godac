import { describe, expect, it } from "vitest";
import { calculerBulletin } from "../calcul";
import { MODELE_TRANSPORT, parametresLegauxAu } from "../parametres";
import type { ParametresEntreprise, ProfilSalarie, VariablesMois } from "../types";

/**
 * Bulletins de référence : modèle de paie transport (IDCC 16) tiré de
 * bulletins réels d'un chauffeur livreur VL (groupe 03 bis, coef. 118M,
 * 151,67 h à 12,31 €) — taux et montants seulement, aucune donnée
 * personnelle. Tolérance : 0,02 €.
 */
const entreprise: ParametresEntreprise = { ...MODELE_TRANSPORT.entreprise, effectif: 5, tauxAccidentTravail: 5.4 };
const salarie: ProfilSalarie = { regime: "sedentaire", cadre: false, tauxHoraire: 12.31, heuresContractuelles: 151.67, tauxPas: 0, groupe: "03 bis" };
const base: VariablesMois = {
  heuresTravaillees: null,
  heuresAbsenceNonPayee: 0,
  joursCongesPris: 0,
  primes: [],
  nbRepas: 0,
  nbRepasUnique: 0,
  nbCasseCroute: 0,
  nbGrandDeplacement: 0,
  cumulHeuresSupExonereesAnnee: 0,
  retenues: [],
};
const proche = (valeur: number, attendu: number) => expect(Math.abs(valeur - attendu)).toBeLessThanOrEqual(0.02);

describe("bulletin de référence — septembre (4 jours de CP, saisie)", () => {
  const b = calculerBulletin({
    legal: parametresLegauxAu("2026-09-01"),
    entreprise,
    salarie,
    variables: {
      ...base,
      nbRepas: 19,
      periodesConges: [{ du: "2026-09-01", au: "2026-09-04", jours: 4 }],
      retenues: [{ type: "saisie", libelle: "Saisie arrêt", montant: 198.5 }],
    },
  });

  it("brut et congés neutres", () => {
    proche(b.brut, 1867.06);
    const cp = b.lignes.filter((l) => l.libelle.startsWith("Congés payés pris") || l.libelle === "Indemnité congés payés");
    expect(cp.reduce((t, l) => t + (l.montantSalarial ?? 0), 0)).toBeCloseTo(0, 2);
    expect(cp[0]?.tauxSalarial).toBe(71.81);
    expect(cp[0]?.libelle).toBe("Congés payés pris 010926-040926 (4 jours)");
  });
  it("cotisations salariales, assiette CSG", () => {
    proche(b.totalSalarial, 490.78);
    proche(b.assietteCsg ?? 0, 1926.65);
  });
  it("nets", () => {
    proche(b.netSocial, 1376.28);
    proche(b.netImposable, 1512.65);
    proche(b.totalDu ?? 0, 1687.12);
    proche(b.netAPayer, 1488.62);
  });
  it("repas et réintégration santé", () => {
    proche(b.fraisNonSoumis, 310.84);
    proche(b.reintegrationSante ?? 0, 80.5);
  });
  it("parts patronales hors réduction (bulletin : 265,55 + 699,40 = 964,95)", () => {
    // Écart d'arrondi ligne à ligne : le bulletin regroupe certaines lignes.
    proche(b.totalPatronalHorsReduction ?? 0, 964.95);
  });
  it("réduction générale : formule RGDU 2026, écart documenté < 1 € (bulletin −699,40, GODAC −700,20)", () => {
    expect(Math.abs(b.reductionGenerale - 699.4)).toBeLessThan(1);
    expect(Math.abs(b.totalPatronal - 265.55)).toBeLessThan(1);
  });
  it("AT/MP : rubrique à part entière (5,40 % du brut)", () => {
    const at = b.lignes.filter((l) => l.section === "at");
    expect(at).toHaveLength(1);
    proche(at[0]?.montantPatronal ?? 0, 100.82);
  });
  it("DFS affichée pour mémoire, non appliquée", () => {
    expect(b.dfs).toMatchObject({ taux: 17, appliquee: false });
    proche(b.dfs?.montant ?? 0, 317.4);
  });
});

describe("bulletin de référence — juillet (8 h sup. à 25 %)", () => {
  const b = calculerBulletin({
    legal: parametresLegauxAu("2026-07-01"),
    entreprise,
    salarie,
    variables: { ...base, nbRepas: 20, heuresSup25: 8, heuresSup50: 0 },
  });

  it("heures sup. et brut", () => {
    const hs = b.lignes.find((l) => l.libelle === "Heures supplémentaires 25 %");
    proche(hs?.montantSalarial ?? 0, 123.1);
    proche(b.brut, 1990.16);
  });
  it("cotisations salariales, assiette CSG", () => {
    proche(b.totalSalarial, 503.4);
    proche(b.assietteCsg ?? 0, 2048.37);
  });
  it("nets", () => {
    proche(b.netSocial, 1486.76);
    proche(b.netImposable, 1511.78);
    proche(b.netAPayer, 1813.96);
  });
  it("parts patronales hors réduction (bulletin : 288,32 + 734,95 = 1 023,27)", () => {
    proche(b.totalPatronalHorsReduction ?? 0, 1023.27);
  });
  it("allègements : RGDU (SMIC de référence majoré des 8 h) + déduction forfaitaire 1,50 €/h ; écart < 1 € (bulletin 734,95, GODAC 723,30 + 12,00)", () => {
    expect(Math.abs(b.totalPatronal - 288.32)).toBeLessThan(1);
  });
});
