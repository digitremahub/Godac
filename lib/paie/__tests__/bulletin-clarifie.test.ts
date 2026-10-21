import { describe, expect, it } from "vitest";
import { calculerBulletin, typeTauxPasEffectif } from "@/lib/paie/calcul";
import { dernierJourDuMois, libellePaiement, paiementDuBulletin, paiementParDefaut } from "@/lib/paie/paiement";
import { parametresLegauxAu, FRAIS_CONVENTIONNELS } from "@/lib/paie/parametres";
import { variablesSchema } from "@/lib/paie/schemas";
import type { ParametresEntreprise, ProfilSalarie, VariablesMois } from "@/lib/paie/types";

/** Bulletin clarifié (arrêté du 25/02/2016, art. R3243-1) : rubrique AT/MP, PAS, date de paiement. */
const legal = parametresLegauxAu("2026-10-01");
const entreprise: ParametresEntreprise = {
  effectif: 8,
  tauxAccidentTravail: 2.5,
  tauxVersementMobilite: 0,
  prevoyance: { salarial: 0, patronal: 0 },
  mutuelle: { salarial: 10, patronal: 10 },
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
const profil = (tauxPas: number | null): ProfilSalarie => ({ regime: "sedentaire", cadre: false, tauxHoraire: 16, heuresContractuelles: 151.67, tauxPas });
const lignePas = (b: ReturnType<typeof calculerBulletin>) => b.lignes.find((l) => l.libelle === "Impôt sur le revenu prélevé à la source");

describe("rubrique Accidents du travail & maladies professionnelles", () => {
  const b = calculerBulletin({ legal, entreprise, salarie: profil(0), variables: vars() });
  const at = b.lignes.filter((l) => l.section === "at");

  it("une rubrique à part entière, hors du groupe Santé", () => {
    expect(at).toHaveLength(1);
    expect(at[0]?.libelle).toBe("Accidents du travail & maladies professionnelles");
    expect(at[0]?.montantPatronal).toBeCloseTo((b.brut * 2.5) / 100, 2);
    expect(b.lignes.some((l) => l.section === "sante" && l.libelle.startsWith("Accidents du travail"))).toBe(false);
  });
  it("placée après Santé et avant Retraite", () => {
    const ordre = Array.from(new Set(b.lignes.map((l) => l.section)));
    expect(ordre.indexOf("sante")).toBeLessThan(ordre.indexOf("at"));
    expect(ordre.indexOf("at")).toBeLessThan(ordre.indexOf("retraite"));
  });
});

describe("prélèvement à la source : type de taux", () => {
  it("personnalisé dès qu'un taux est saisi au profil", () => {
    const b = calculerBulletin({ legal, entreprise, salarie: profil(4.2), variables: vars() });
    expect(b.typeTauxPas).toBe("personnalise");
    expect(b.tauxPas).toBe(4.2);
    expect(lignePas(b)).toMatchObject({ base: b.netImposable, tauxSalarial: 4.2, montantSalarial: b.montantPas, mention: "Taux personnalisé" });
  });
  it("non personnalisé (grille du taux neutre) sans taux au profil", () => {
    const b = calculerBulletin({ legal, entreprise, salarie: profil(null), variables: vars() });
    expect(b.typeTauxPas).toBe("non_personnalise");
    expect(lignePas(b)?.mention).toBe("Taux non personnalisé");
  });
  it("le choix « non personnalisé » du mois applique la grille malgré un taux au profil", () => {
    const neutre = calculerBulletin({ legal, entreprise, salarie: profil(null), variables: vars() });
    const b = calculerBulletin({ legal, entreprise, salarie: profil(4.2), variables: vars({ typeTauxPas: "non_personnalise" }) });
    expect(b.typeTauxPas).toBe("non_personnalise");
    expect(b.tauxPas).toBe(neutre.tauxPas);
  });
  it("pas de taux personnalisé sans taux saisi", () => {
    expect(typeTauxPasEffectif(null, "personnalise")).toBe("non_personnalise");
    expect(typeTauxPasEffectif(0, null)).toBe("personnalise");
  });
});

describe("date et mode de paiement", () => {
  it("par défaut : dernier jour du mois, par virement", () => {
    expect(paiementParDefaut("2026-09")).toEqual({ datePaiement: "2026-09-30", modePaiement: "virement" });
    expect(dernierJourDuMois("2028-02")).toBe("2028-02-29");
    expect(paiementDuBulletin("2026-12", {})).toEqual({ datePaiement: "2026-12-31", modePaiement: "virement" });
  });
  it("modifiables dans les variables du mois", () => {
    expect(paiementDuBulletin("2026-09", { datePaiement: "2026-10-02", modePaiement: "cheque" })).toEqual({ datePaiement: "2026-10-02", modePaiement: "cheque" });
    const v = variablesSchema.parse({ ...vars(), datePaiement: "2026-10-02", modePaiement: "especes", typeTauxPas: "non_personnalise" });
    expect(v).toMatchObject({ datePaiement: "2026-10-02", modePaiement: "especes", typeTauxPas: "non_personnalise" });
  });
  it("libellé du bulletin", () => {
    expect(libellePaiement("2026-09-30", "virement")).toBe("Paiement le 30/09/2026 par virement");
    expect(libellePaiement("2026-10-02", "especes")).toBe("Paiement le 02/10/2026 en espèces");
  });
});
