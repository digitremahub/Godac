import { describe, expect, it } from "vitest";
import { calculerBulletin, tauxNeutre } from "@/lib/paie/calcul";
import { parametresLegauxAu, FRAIS_CONVENTIONNELS } from "@/lib/paie/parametres";
import type { ParametresEntreprise, ProfilSalarie, VariablesMois } from "@/lib/paie/types";

const legal = parametresLegauxAu("2026-10-01");
const entreprise: ParametresEntreprise = {
  effectif: 8,
  tauxAccidentTravail: 2.5,
  tauxVersementMobilite: 0,
  prevoyance: { salarial: 0, patronal: 0 },
  mutuelle: { salarial: 0, patronal: 0 },
  frais: FRAIS_CONVENTIONNELS,
};
const vars = (v: Partial<VariablesMois> = {}): VariablesMois => ({
  heuresTravaillees: null,
  heuresAbsenceNonPayee: 0,
  joursCongesPris: 0,
  primes: [],
  nbRepas: 0,
  nbRepasUnique: 0,
  nbCasseCroute: 0,
  nbGrandDeplacement: 0,
  cumulHeuresSupExonereesAnnee: 0,
  ...v,
});
const sedentaireSmic: ProfilSalarie = { regime: "sedentaire", cadre: false, tauxHoraire: legal.smicHoraire, heuresContractuelles: 151.67, tauxPas: 0 };

describe("calculerBulletin", () => {
  it("salarié au SMIC 35 h : brut = SMIC mensuel, net autour de 79 % du brut", () => {
    const b = calculerBulletin({ legal, entreprise, salarie: sedentaireSmic, variables: vars() });
    expect(b.brut).toBeCloseTo(legal.smicHoraire * 151.67, 1);
    expect(b.netAvantImpot / b.brut).toBeGreaterThan(0.77);
    expect(b.netAvantImpot / b.brut).toBeLessThan(0.8);
    // Au SMIC, la réduction générale est à son maximum.
    expect(b.reductionGenerale).toBeGreaterThan(0.3 * b.brut);
  });

  it("totaux cohérents : brut − cotisations = net, net − PAS + frais = net à payer", () => {
    const b = calculerBulletin({
      legal,
      entreprise,
      salarie: { regime: "grand_routier", cadre: false, tauxHoraire: 12.6, heuresContractuelles: 186.33, tauxPas: 3.5 },
      variables: vars({ heuresTravaillees: 200, nbRepas: 20, nbGrandDeplacement: 4, primes: [{ libelle: "Prime qualité", montant: 80, soumise: true }] }),
    });
    expect(b.netAvantImpot).toBeCloseTo(b.brut - b.totalSalarial, 2);
    expect(b.netAPayer).toBeCloseTo(b.netAvantImpot - b.montantPas + b.fraisNonSoumis, 2);
    expect(b.montantPas).toBeCloseTo(b.netImposable * 0.035, 2);
    expect(b.fraisNonSoumis).toBeCloseTo(20 * FRAIS_CONVENTIONNELS.repas + 4 * FRAIS_CONVENTIONNELS.grandDeplacement, 2);
  });

  it("grand routier : 151,67 h de base, équivalence à 25 % jusqu'à 186,33 h, puis 50 %", () => {
    const b = calculerBulletin({
      legal,
      entreprise,
      salarie: { regime: "grand_routier", cadre: false, tauxHoraire: 12.6, heuresContractuelles: 186.33, tauxPas: 0 },
      variables: vars({ heuresTravaillees: 200 }),
    });
    expect(b.heures).toEqual({ base: 151.67, sup25: 34.66, sup50: 13.67, absence: 0 });
    const equiv = b.lignes.find((l) => l.libelle.startsWith("Heures d'équivalence"));
    expect(equiv?.base).toBe(34.66);
    expect(b.brut).toBeCloseTo(151.67 * 12.6 + 34.66 * 12.6 * 1.25 + 13.67 * 12.6 * 1.5, 1);
    expect(b.lignes.some((l) => l.libelle.startsWith("Réduction de cotisations salariales"))).toBe(true);
  });

  it("mensualisation : un mois court est payé au contrat", () => {
    const b = calculerBulletin({
      legal,
      entreprise,
      salarie: { regime: "courte_distance", cadre: false, tauxHoraire: 12.6, heuresContractuelles: 169, tauxPas: 0 },
      variables: vars({ heuresTravaillees: 120 }),
    });
    expect(b.heures.base + b.heures.sup25).toBeCloseTo(169, 2);
  });

  it("absence non rémunérée déduite du brut", () => {
    const sans = calculerBulletin({ legal, entreprise, salarie: sedentaireSmic, variables: vars() });
    const avec = calculerBulletin({ legal, entreprise, salarie: sedentaireSmic, variables: vars({ heuresAbsenceNonPayee: 7 }) });
    expect(sans.brut - avec.brut).toBeCloseTo(7 * legal.smicHoraire, 2);
  });

  it("cadre au-dessus du plafond : tranche 2, CET et APEC présents", () => {
    const b = calculerBulletin({
      legal,
      entreprise,
      salarie: { regime: "sedentaire", cadre: true, tauxHoraire: 40, heuresContractuelles: 151.67, tauxPas: 10 },
      variables: vars(),
    });
    expect(b.brut).toBeGreaterThan(legal.pmss);
    for (const libelle of ["Complémentaire Agirc-Arrco tranche 2", "Contribution d'équilibre technique", "APEC", "Prévoyance cadre"]) {
      expect(b.lignes.some((l) => l.libelle === libelle)).toBe(true);
    }
    expect(b.reductionGenerale).toBe(0);
  });

  it("taux neutre : barème appliqué au net imposable", () => {
    expect(tauxNeutre(legal.tauxNeutrePas, 1000)).toBe(0);
    expect(tauxNeutre(legal.tauxNeutrePas, 2500)).toBeGreaterThan(0);
  });
});

describe("RGDU transport routier", () => {
  it("le SMIC de référence d'un grand routier intègre le 45/35 : réduction plus forte qu'un sédentaire au même brut", () => {
    const base = { cadre: false, tauxHoraire: 12.6, tauxPas: 0 };
    const gr = calculerBulletin({ legal, entreprise, salarie: { ...base, regime: "grand_routier", heuresContractuelles: 186.33 }, variables: vars() });
    const sed = calculerBulletin({ legal, entreprise, salarie: { ...base, regime: "sedentaire", tauxHoraire: gr.brut / 151.67, heuresContractuelles: 151.67 }, variables: vars() });
    expect(gr.brut).toBeCloseTo(sed.brut, 0);
    expect(gr.reductionGenerale).toBeGreaterThan(sed.reductionGenerale);
  });
});

describe("acomptes et saisies", () => {
  it("déduits après le net, avec contrôle de la part saisissable", () => {
    const base = calculerBulletin({ legal, entreprise, salarie: sedentaireSmic, variables: vars() });
    const b = calculerBulletin({
      legal,
      entreprise,
      salarie: sedentaireSmic,
      variables: { ...vars(), retenues: [{ type: "acompte", libelle: "", montant: 200 }, { type: "atd", libelle: "DGFiP", montant: 900, reference: "A-123" }] },
    });
    expect(b.netAvantRetenues).toBe(base.netAPayer);
    expect(b.totalRetenues).toBe(1100);
    expect(b.netAPayer).toBeCloseTo(base.netAPayer - 1100, 2);
    expect(b.lignes.some((l) => l.libelle.startsWith("Saisie administrative (ATD) — DGFiP — réf. A-123"))).toBe(true);
    expect(b.avertissements.some((a) => a.includes("part saisissable"))).toBe(true);
  });
});
