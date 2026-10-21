import { describe, expect, it } from "vitest";
import { calculerBulletin } from "../calcul";
import { acquisDuMois, soldeConges } from "../conges";
import { MODELE_TRANSPORT, parametresLegauxAu } from "../parametres";
import type { ParametresEntreprise, ProfilSalarie, VariablesMois } from "../types";

const entreprise: ParametresEntreprise = { ...MODELE_TRANSPORT.entreprise, effectif: 5, tauxAccidentTravail: 5.4 };
const salarie: ProfilSalarie = { regime: "sedentaire", cadre: false, tauxHoraire: 12.31, heuresContractuelles: 151.67, tauxPas: 0, groupe: "03 bis" };
const variables: VariablesMois = {
  heuresTravaillees: null,
  heuresAbsenceNonPayee: 0,
  joursCongesPris: 0,
  primes: [],
  nbRepas: 19,
  nbRepasUnique: 0,
  nbCasseCroute: 0,
  nbGrandDeplacement: 0,
  cumulHeuresSupExonereesAnnee: 0,
  periodesConges: [{ du: "2026-09-01", au: "2026-09-04", jours: 4 }],
  retenues: [{ type: "saisie", libelle: "Saisie arrêt", montant: 198.5 }],
};
const legal = parametresLegauxAu("2026-09-01");
const indemnite = (b: ReturnType<typeof calculerBulletin>) => b.lignes.find((l) => l.libelle.startsWith("Indemnité congés payés"));

describe("indemnité de congés payés : dixième ou maintien", () => {
  it("bulletin de référence inchangé quand le dixième est moins favorable", () => {
    // 4 j de maintien = 287,24 € ; dixième : 20 000 × 10 % × 4 / 30 = 266,67 €.
    const b = calculerBulletin({ legal, entreprise, salarie, variables: { ...variables, cpReference: { brut: 20000, joursAcquis: 30, du: "2025-06-01", au: "2026-05-31" } } });
    expect(b.indemniteCp?.retenue).toBe("maintien");
    expect(indemnite(b)?.montantSalarial).toBe(287.24);
    expect(Math.abs(b.brut - 1867.06)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(b.netAPayer - 1488.62)).toBeLessThanOrEqual(0.02);
  });
  it("sans cumuls de la période de référence : maintien seul, avec la mention", () => {
    const b = calculerBulletin({ legal, entreprise, salarie, variables });
    expect(b.indemniteCp?.dixieme).toBeNull();
    expect(indemnite(b)?.mention).toMatch(/maintien de salaire/);
  });
  it("dixième plus favorable : indemnité au dixième, brut augmenté de l'écart", () => {
    // 30 000 × 10 % × 4 / 30 = 400 € > 287,24 €.
    const b = calculerBulletin({ legal, entreprise, salarie, variables: { ...variables, cpReference: { brut: 30000, joursAcquis: 30, du: "2025-06-01", au: "2026-05-31" } } });
    expect(b.indemniteCp?.retenue).toBe("dixieme");
    expect(indemnite(b)?.libelle).toBe("Indemnité congés payés (règle du dixième)");
    expect(indemnite(b)?.montantSalarial).toBe(400);
    expect(b.brut).toBeCloseTo(1867.06 + 400 - 287.24, 1);
  });
});

describe("acquisition des congés pendant un arrêt (loi du 22/04/2024)", () => {
  it("mois entier : maladie 2 j, AT 2,5 j, sans solde 0 j", () => {
    expect(acquisDuMois("2026-09-30", [{ du: "2026-09-01", au: "2026-09-30", nature: "maladie" }]).jours).toBe(2);
    expect(acquisDuMois("2026-09-30", [{ du: "2026-09-01", au: "2026-09-30", nature: "assimilee" }]).jours).toBe(2.5);
    expect(acquisDuMois("2026-09-30", [{ du: "2026-09-01", au: "2026-09-30", nature: "sans_solde" }]).jours).toBe(0);
    expect(acquisDuMois("2026-09-30").jours).toBe(2.5);
  });
  it("mois partiel au prorata des jours calendaires", () => {
    expect(acquisDuMois("2026-09-30", [{ du: "2026-09-16", au: "2026-10-20", nature: "maladie" }]).jours).toBe(2.25);
  });
  it("maladie : 24 jours au plus par période", () => {
    expect(acquisDuMois("2026-09-30", [{ du: "2026-09-01", au: "2026-09-30", nature: "maladie" }], 23).jours).toBe(1);
    const s = soldeConges({ reprise: { au: "2025-05-31", n1: 0, n: 0 }, aujourdhui: "2026-05-31", valides: [], absences: [{ du: "2025-06-01", au: "2026-05-31", nature: "maladie" }] });
    expect(s.n.acquis).toBe(24);
  });
  it("AT / maladie professionnelle toute l'année : 30 jours", () => {
    const s = soldeConges({ reprise: { au: "2025-05-31", n1: 0, n: 0 }, aujourdhui: "2026-05-31", valides: [], absences: [{ du: "2025-06-01", au: "2026-05-31", nature: "assimilee" }] });
    expect(s.n.acquis).toBe(30);
  });
});
