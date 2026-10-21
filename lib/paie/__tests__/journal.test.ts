import { describe, expect, it } from "vitest";
import { ligneJournal, totauxJournal, ventiler } from "@/lib/paie/journal";
import type { Bulletin, LigneBulletin } from "@/lib/paie/types";

// Bulletins fictifs simplifiés.
function bulletin(brut: number, lignes: LigneBulletin[], extra: Partial<Bulletin> = {}): Bulletin {
  return {
    lignes,
    heures: { base: 151.67, sup25: 0, sup50: 0, absence: 0 },
    brut,
    totalSalarial: 0,
    totalPatronal: 0,
    reductionGenerale: 0,
    netAvantImpot: 0,
    netSocial: 0,
    netImposable: 0,
    tauxPas: 0,
    montantPas: 0,
    fraisNonSoumis: 0,
    netAvantRetenues: 0,
    totalRetenues: 0,
    partSaisissable: 0,
    netAPayer: 0,
    coutEmployeur: 0,
    heuresSupExonerees: 0,
    avertissements: [],
    ...extra,
  };
}
const l = (section: LigneBulletin["section"], sal: number | null, pat: number | null, gain = false): LigneBulletin => ({
  section,
  libelle: section,
  base: null,
  tauxSalarial: null,
  montantSalarial: sal,
  tauxPatronal: null,
  montantPatronal: pat,
  gain,
});

describe("journal de paie", () => {
  it("ventile par rubrique sans compter les gains", () => {
    const v = ventiler({ lignes: [l("brut", 2000, null, true), l("sante", 0, 140.1), l("sante", 10, 5), l("csg", 135.25, null), l("net", 288, null, true)] });
    expect(v.sante).toEqual({ salarial: 10, patronal: 145.1 });
    expect(v.csg).toEqual({ salarial: 135.25, patronal: 0 });
    expect(v.retraite).toEqual({ salarial: 0, patronal: 0 });
  });

  it("totaux de l'entreprise au centime, non validés comptés", () => {
    const a = ligneJournal(
      { id: "a", nom: "Salarié A" },
      { validation_status: "valide", details: bulletin(2000.1, [l("retraite", 138.01, 171.01), l("net", 100, null, true)], { totalSalarial: 138.01, totalPatronal: 171.01, netAPayer: 1700.2, coutEmployeur: 2271.11, reductionGenerale: 50.5 }) },
    );
    const b = ligneJournal(
      { id: "b", nom: "Salarié B" },
      { validation_status: "en_attente", details: bulletin(1800.2, [l("retraite", 124.2, 153.9)], { totalSalarial: 124.2, totalPatronal: 153.9, netAPayer: 1500.1, coutEmployeur: 1954.1 }) },
    );
    expect(a.frais).toBe(100);
    const t = totauxJournal([a, b]);
    expect(t.effectif).toBe(2);
    expect(t.nonValides).toBe(1);
    expect(t.brut).toBe(3800.3);
    expect(t.rubriques.retraite).toEqual({ salarial: 262.21, patronal: 324.91 });
    expect(t.totalPatronal).toBe(324.91);
    expect(t.netPaye).toBe(3200.3);
    expect(t.coutTotal).toBe(4225.21);
    expect(t.reductionGenerale).toBe(50.5);
  });

  it("journal vide : totaux nuls", () => {
    const t = totauxJournal([]);
    expect(t.effectif).toBe(0);
    expect(t.brut).toBe(0);
  });
});
