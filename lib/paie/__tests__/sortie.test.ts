import { describe, expect, it } from "vitest";
import { calculerBulletin } from "../calcul";
import { calculerSortie, indemniteConges, indemniteLegaleLicenciement, traitementRupture } from "../sortie";
import { MODELE_TRANSPORT, parametresLegauxAu } from "../parametres";
import type { ProfilSalarie, VariablesMois } from "../types";

const legal = parametresLegauxAu("2026-09-01");
const douze = Array.from({ length: 12 }, () => 2000);

describe("indemnité compensatrice de congés payés", () => {
  it("dixième plus favorable que le maintien", () => {
    const i = indemniteConges({ jours: 10, salaireMensuel: 1867.06, reference: { brut: 24000, joursAcquis: 30 } });
    expect(i.maintien).toBe(718.1);
    expect(i.dixieme).toBe(800);
    expect(i.methode).toBe("dixieme");
    expect(i.montant).toBe(800);
  });
  it("maintien seul sans cumuls de référence", () => {
    const i = indemniteConges({ jours: 5, salaireMensuel: 1867.06, reference: null });
    expect(i.methode).toBe("maintien");
    expect(i.montant).toBe(359.05);
  });
});

describe("indemnité légale de licenciement", () => {
  it("moins de 10 ans : 1/4 de mois par année (6 ans et 6 mois)", () => {
    const i = indemniteLegaleLicenciement({ entree: "2020-03-01", sortie: "2026-09-01", salairesMensuels: douze });
    expect(i.anciennete).toBe(6.5);
    expect(i.montant).toBe(3250);
  });
  it("plus de 10 ans : 1/3 de mois au-delà (16 ans)", () => {
    const i = indemniteLegaleLicenciement({ entree: "2010-09-01", sortie: "2026-09-01", salairesMensuels: douze });
    expect(i.montant).toBe(9000);
  });
  it("salaire de référence : moyenne des 3 derniers mois si plus favorable", () => {
    const i = indemniteLegaleLicenciement({ entree: "2020-09-01", sortie: "2026-09-01", salairesMensuels: [...Array(9).fill(2000), 2600, 2600, 2600] });
    expect(i.moyenne12).toBe(2150);
    expect(i.salaireReference).toBe(2600);
    expect(i.montant).toBe(3900);
  });
  it("moins de 8 mois d'ancienneté : pas d'indemnité", () => {
    expect(indemniteLegaleLicenciement({ entree: "2026-03-01", sortie: "2026-09-01", salairesMensuels: douze }).montant).toBe(0);
  });
});

describe("rupture conventionnelle", () => {
  const donnees = {
    date: "2026-09-30",
    motif: "rupture_conventionnelle" as const,
    entree: "2020-03-01",
    preavis: { type: "sans" as const, jours: null, montant: null },
    joursCpRestants: 0,
    salaireMensuel: 2000,
    salairesMensuels: douze,
    remunerationAnnuellePrecedente: 24000,
    referenceCp: null,
  };
  it("avertit si le montant est inférieur à l'indemnité légale", () => {
    const r = calculerSortie({ ...donnees, montantRupture: 2000 }, legal);
    expect(r.avertissements.some((a) => a.includes("inférieure à l'indemnité légale"))).toBe(true);
  });
  it("exonérée dans les limites, contribution patronale sur la part exonérée", () => {
    const r = traitementRupture({ motif: "rupture_conventionnelle", montant: 10000, indemniteLegale: 3250, remunerationAnnuellePrecedente: 24000, legal });
    expect(r.exonereeFiscal).toBe(10000);
    expect(r.exonereeSocial).toBe(10000);
    expect(r.baseCsg).toBe(6750);
    expect(r.contributionPatronale).toBe(40);
  });
});

describe("bulletin de sortie", () => {
  it("licenciement : jours après la sortie retirés, ICCP et indemnité légale", () => {
    const salarie: ProfilSalarie = { regime: "sedentaire", cadre: false, tauxHoraire: 12.31, heuresContractuelles: 151.67, tauxPas: 0, dateEntree: "2020-03-01" };
    const { elements } = calculerSortie(
      { date: "2026-09-15", motif: "licenciement", entree: "2020-03-01", preavis: { type: "paye", jours: null, montant: 1000 }, montantRupture: null, joursCpRestants: 5, salaireMensuel: 1867.06, salairesMensuels: douze, remunerationAnnuellePrecedente: 24000, referenceCp: null },
      legal,
    );
    const variables: VariablesMois = { heuresTravaillees: null, heuresAbsenceNonPayee: 0, joursCongesPris: 0, primes: [], nbRepas: 0, nbRepasUnique: 0, nbCasseCroute: 0, nbGrandDeplacement: 0, cumulHeuresSupExonereesAnnee: 0, sortie: elements };
    const b = calculerBulletin({ legal, entreprise: { ...MODELE_TRANSPORT.entreprise, effectif: 5 }, salarie, variables, periode: { debut: "2026-09-01", fin: "2026-09-30" } });
    expect(b.lignes.some((l) => l.libelle.startsWith("Sortie le 15/09"))).toBe(true);
    expect(b.lignes.some((l) => l.libelle.startsWith("Indemnité compensatrice de congés payés (5 j)"))).toBe(true);
    // Indemnité légale (6 ans 6 mois, 2 000 €) : 3 250 € exonérés, après le net.
    expect(b.lignes.find((l) => l.libelle === "Indemnité de licenciement (part exonérée)")?.montantSalarial).toBe(3250);
    expect(b.brut).toBeCloseTo(1867.06 / 2 + 359.05 + 1000, 1);
  });
});
