import { describe, expect, it } from "vitest";
import { calculerBulletin } from "../calcul";
import { calculerArret, dureePeriodeMaintien, tauxMaintienDuJour } from "../arrets";
import { MODELE_TRANSPORT, parametresLegauxAu } from "../parametres";
import type { ArretTravail, ParametresEntreprise, ProfilSalarie, VariablesMois } from "../types";

const legal = parametresLegauxAu("2026-09-01");
const entreprise: ParametresEntreprise = { ...MODELE_TRANSPORT.entreprise, effectif: 5 };
const salarie: ProfilSalarie = { regime: "sedentaire", cadre: false, tauxHoraire: 12.31, heuresContractuelles: 151.67, tauxPas: 0, dateEntree: "2020-01-06" };
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
};
const periode = { debut: "2026-09-01", fin: "2026-09-30" };
const salaire = 1867.06; // 151,67 h × 12,31 €
const parJour = salaire / 30;
const maladie: ArretTravail = { type: "maladie", du: "2026-09-07", au: "2026-09-16", ijssBrutesJour: 30 };

describe("délai de carence", () => {
  it("maladie : 3 jours sans IJSS, 7 jours sans maintien employeur", () => {
    const c = calculerArret({ arret: maladie, debutMois: periode.debut, finMois: periode.fin, salaireMensuel: salaire, dateEntree: salarie.dateEntree });
    expect(c.jours).toBe(10);
    expect(c.joursIjss).toBe(7);
    expect(c.ijssBrutes).toBe(210);
    expect(c.deduction).toBeCloseTo(10 * parJour, 2);
    // Jours 8 à 10 : 90 % du salaire journalier − 30 € d'IJSS.
    expect(c.maintien).toBeCloseTo(3 * (0.9 * parJour - 30), 1);
  });
  it("AT / maladie professionnelle : ni carence IJSS ni carence employeur", () => {
    const c = calculerArret({ arret: { ...maladie, type: "at_mp" }, debutMois: periode.debut, finMois: periode.fin, salaireMensuel: salaire, dateEntree: salarie.dateEntree });
    expect(c.joursIjss).toBe(10);
    expect(c.maintien).toBeCloseTo(10 * (0.9 * parJour - 30), 1);
  });
  it("prolongation : pas de nouvelle carence, durées depuis l'arrêt initial", () => {
    const c = calculerArret({
      arret: { ...maladie, du: "2026-09-01", au: "2026-09-05", prolongationDu: "2026-08-20" },
      debutMois: periode.debut,
      finMois: periode.fin,
      salaireMensuel: salaire,
      dateEntree: salarie.dateEntree,
    });
    expect(c.joursIjss).toBe(5);
    expect(c.maintien).toBeCloseTo(5 * (0.9 * parJour - 30), 1);
  });
  it("congé sans solde : retenue seule, sans IJSS ni maintien", () => {
    const c = calculerArret({ arret: { type: "sans_solde", du: "2026-09-07", au: "2026-09-08" }, debutMois: periode.debut, finMois: periode.fin, salaireMensuel: salaire, dateEntree: salarie.dateEntree });
    expect(c.joursIjss).toBe(0);
    expect(c.maintien).toBe(0);
    expect(c.deduction).toBeCloseTo(2 * parJour, 2);
  });
});

describe("maintien légal selon l'ancienneté", () => {
  it("durée de chaque période : 30 j de 1 à 5 ans, + 10 j par 5 ans, 90 j au plus", () => {
    expect(dureePeriodeMaintien(0)).toBe(0);
    expect(dureePeriodeMaintien(1)).toBe(30);
    expect(dureePeriodeMaintien(5)).toBe(30);
    expect(dureePeriodeMaintien(6)).toBe(40);
    expect(dureePeriodeMaintien(11)).toBe(50);
    expect(dureePeriodeMaintien(31)).toBe(90);
    expect(dureePeriodeMaintien(45)).toBe(90);
  });
  it("90 % puis 66,66 % puis plus rien (2 ans d'ancienneté)", () => {
    expect(tauxMaintienDuJour("maladie", 7, 24)).toBe(0);
    expect(tauxMaintienDuJour("maladie", 8, 24)).toBe(90);
    expect(tauxMaintienDuJour("maladie", 37, 24)).toBe(90);
    expect(tauxMaintienDuJour("maladie", 38, 24)).toBe(66.66);
    expect(tauxMaintienDuJour("maladie", 67, 24)).toBe(66.66);
    expect(tauxMaintienDuJour("maladie", 68, 24)).toBe(0);
    expect(tauxMaintienDuJour("at_mp", 1, 24)).toBe(90);
  });
  it("moins d'un an d'ancienneté : aucun maintien légal", () => {
    const c = calculerArret({ arret: maladie, debutMois: periode.debut, finMois: periode.fin, salaireMensuel: salaire, dateEntree: "2026-01-05" });
    expect(c.maintien).toBe(0);
    expect(c.mention).toMatch(/moins d'un an/);
  });
  it("maintien conventionnel plus favorable (sans carence) retenu jour par jour", () => {
    const c = calculerArret({
      arret: maladie,
      debutMois: periode.debut,
      finMois: periode.fin,
      salaireMensuel: salaire,
      dateEntree: salarie.dateEntree,
      maintienConventionnel: { ancienneteMinMois: 12, carenceMaladie: 0, carenceAt: 0, taux1: 100, taux2: 75, dureeBase: 30, dureeIncrement: 0, trancheAnnees: 5, dureeMax: 30 },
    });
    // Jours 1 à 3 : 100 % sans IJSS ; jours 4 à 10 : 100 % − 30 €.
    expect(c.maintien).toBeCloseTo(3 * parJour + 7 * (parJour - 30), 1);
    expect(c.mention).toMatch(/conventionnel/);
  });
  it("maternité : IJSS sans maintien légal", () => {
    const c = calculerArret({ arret: { ...maladie, type: "maternite" }, debutMois: periode.debut, finMois: periode.fin, salaireMensuel: salaire, dateEntree: salarie.dateEntree });
    expect(c.joursIjss).toBe(10);
    expect(c.maintien).toBe(0);
  });
});

describe("subrogation", () => {
  const avec = calculerBulletin({ legal, entreprise, salarie, periode, variables: { ...base, arrets: [maladie], subrogation: true } });
  const sans = calculerBulletin({ legal, entreprise, salarie, periode, variables: { ...base, arrets: [maladie], subrogation: false } });

  it("lignes d'absence, d'IJSS et de maintien dans la rémunération", () => {
    const libelles = avec.lignes.filter((l) => l.section === "brut").map((l) => l.libelle);
    expect(libelles).toContain("Absence maladie du 07/09 au 16/09");
    expect(libelles).toContain("IJSS brutes");
    expect(libelles).toContain("Maintien de salaire");
    expect(avec.lignes.some((l) => l.libelle === "IJSS nettes")).toBe(true);
  });
  it("avec subrogation : IJSS brutes dans le brut, hors assiette ; CSG/CRDS 6,7 % sur les IJSS", () => {
    expect(avec.ijssBrutes).toBe(210);
    expect(avec.brut).toBeCloseTo(sans.brut + 210, 2);
    const csgIj = avec.lignes.filter((l) => l.libelle.endsWith("sur IJSS")).reduce((t, l) => t + (l.montantSalarial ?? 0), 0);
    expect(csgIj).toBeCloseTo(210 * 0.067, 1);
    // Mêmes cotisations patronales : les IJSS ne sont pas soumises.
    expect(avec.totalPatronal).toBeCloseTo(sans.totalPatronal, 2);
    // Le salarié reçoit en plus les IJSS nettes.
    expect(avec.netAPayer - sans.netAPayer).toBeCloseTo(210 - csgIj, 1);
    expect(avec.ijssNettes).toBeCloseTo(210 - csgIj, 1);
  });
  it("sans subrogation : seul le complément employeur figure", () => {
    expect(sans.lignes.some((l) => l.libelle === "IJSS brutes")).toBe(false);
    expect(sans.brut).toBeCloseTo(salaire - 10 * parJour + 3 * (0.9 * parJour - 30), 1);
  });
  it("maintien saisi à la main", () => {
    const b = calculerBulletin({ legal, entreprise, salarie, periode, variables: { ...base, arrets: [{ ...maladie, maintienManuel: 100 }] } });
    expect(b.lignes.find((l) => l.libelle === "Maintien de salaire")?.montantSalarial).toBe(100);
  });
});
