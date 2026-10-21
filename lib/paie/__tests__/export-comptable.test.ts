import { describe, expect, it } from "vitest";
import { BOM, celluleCsv, dateFr, documentCsv, ligneCsv, nombreFr } from "@/lib/paie/csv";
import { controlesExport, csvComplet, csvVariables, detailPrimes, ENTETE_COMPLET, ENTETE_VARIABLES, ligneComplete, type BulletinExport, type SalarieExport } from "@/lib/paie/export-comptable";
import type { Bulletin, VariablesMois } from "@/lib/paie/types";

// Données fictives.
const variables: VariablesMois = {
  heuresTravaillees: 160,
  heuresAbsenceNonPayee: 2,
  joursCongesPris: 0,
  periodesConges: [{ du: "2026-09-14", au: "2026-09-15", jours: 2 }],
  primes: [
    { libelle: "Prime de nuit", montant: 120, soumise: true },
    { libelle: "Indemnité outillage; \"spéciale\"", montant: 30, soumise: false },
  ],
  nbRepas: 18,
  nbRepasUnique: 1,
  nbCasseCroute: 2,
  nbGrandDeplacement: 0,
  cumulHeuresSupExonereesAnnee: 0,
  retenues: [
    { type: "acompte", libelle: "Acompte du 10/09", montant: 200 },
    { type: "saisie", libelle: "Saisie sur salaire", montant: 50, reference: "RG 12/345" },
    { type: "pret", libelle: "Prêt employeur", montant: 25 },
  ],
  datePaiement: "2026-09-30",
  modePaiement: "virement",
};

const bulletin: Bulletin = {
  lignes: [
    { section: "brut", libelle: "Salaire de base", base: 151.67, tauxSalarial: 13, montantSalarial: 1971.71, tauxPatronal: null, montantPatronal: null, gain: true },
    { section: "sante", libelle: "Maladie", base: 2100, tauxSalarial: null, montantSalarial: 0, tauxPatronal: 7, montantPatronal: 147 },
    { section: "retraite", libelle: "Vieillesse", base: 2100, tauxSalarial: 6.9, montantSalarial: 144.9, tauxPatronal: 8.55, montantPatronal: 179.55 },
    { section: "csg", libelle: "CSG déductible", base: 2063.25, tauxSalarial: 6.8, montantSalarial: 140.3, tauxPatronal: null, montantPatronal: null },
    { section: "exonerations", libelle: "Réduction générale", base: 2100, tauxSalarial: null, montantSalarial: null, tauxPatronal: -10, montantPatronal: -210 },
    { section: "net", libelle: "Indemnité de repas", base: 18, tauxSalarial: 16, montantSalarial: 288, tauxPatronal: null, montantPatronal: null, gain: true },
    { section: "net", libelle: "Impôt sur le revenu prélevé à la source", base: 1800, tauxSalarial: 2, montantSalarial: 36, tauxPatronal: null, montantPatronal: null },
  ],
  heures: { base: 151.67, sup25: 8.33, sup50: 0, absence: 2 },
  brut: 2100,
  totalSalarial: 285.2,
  totalPatronal: 116.55,
  reductionGenerale: 210,
  netAvantImpot: 1814.8,
  netSocial: 1814.8,
  netImposable: 1800,
  tauxPas: 2,
  typeTauxPas: "personnalise",
  montantPas: 36,
  fraisNonSoumis: 318,
  netAvantRetenues: 2096.8,
  totalRetenues: 275,
  partSaisissable: 300,
  netAPayer: 1821.8,
  coutEmployeur: 2534.55,
  heuresSupExonerees: 0,
  avertissements: [],
};

const salaries: SalarieExport[] = [
  { id: "u1", nom: "Martin Exemple", emploi: "Conducteur SPL", matricule: "M001", coefficient: "150M", actif: true },
  { id: "u2", nom: "Durand Fictif", emploi: "Conducteur VL", matricule: "M002", coefficient: null, actif: true, papierDemande: true },
  { id: "u3", nom: "Ancien Salarié", emploi: null, matricule: null, coefficient: null, actif: false },
];
const b1: BulletinExport = { id: "p1", user_id: "u1", validation_status: "en_attente", gross_amount: 2100, net_amount: 1821.8, details: bulletin, variables };

describe("CSV au format français", () => {
  it("décimales à la virgule, pas de -0", () => {
    expect(nombreFr(1234.5)).toBe("1234,50");
    expect(nombreFr(-0.001)).toBe("0,00");
    expect(nombreFr(null)).toBe("");
    expect(nombreFr(Number.NaN)).toBe("");
  });

  it("dates JJ/MM/AAAA", () => {
    expect(dateFr("2026-09-30")).toBe("30/09/2026");
    expect(dateFr(null)).toBe("");
  });

  it("échappe séparateur, guillemets et sauts de ligne", () => {
    expect(celluleCsv("simple")).toBe("simple");
    expect(celluleCsv("a;b")).toBe('"a;b"');
    expect(celluleCsv('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(celluleCsv("ligne1\nligne2")).toBe('"ligne1\nligne2"');
    expect(celluleCsv(true)).toBe("oui");
    expect(celluleCsv(undefined)).toBe("");
  });

  it("neutralise les formules (injection CSV)", () => {
    expect(celluleCsv("=SOMME(A1)")).toBe("'=SOMME(A1)");
    expect(celluleCsv("-12")).toBe("'-12");
    expect(celluleCsv(-12)).toBe("-12,00");
  });

  it("document : BOM UTF-8, point-virgule, CRLF", () => {
    const doc = documentCsv(["A", "B"], [[1.5, "é"]]);
    expect(doc.startsWith(BOM)).toBe(true);
    expect(doc).toBe(`${BOM}A;B\r\n1,50;é\r\n`);
    expect(ligneCsv(["x", 2])).toBe("x;2,00");
  });
});

describe("export complet", () => {
  it("une ligne par salarié, alignée sur l'en-tête", () => {
    const l = ligneComplete("2026-09", salaries[0]!, b1);
    expect(l).toHaveLength(ENTETE_COMPLET.length);
    const col = (nom: string) => l[ENTETE_COMPLET.indexOf(nom)];
    expect(col("Matricule")).toBe("M001");
    expect(col("Statut du bulletin")).toBe("En attente de validation direction");
    expect(col("Heures sup. 25 %")).toBe(8.33);
    expect(col("Jours de CP pris")).toBe(2);
    expect(col("Paniers repas (nb)")).toBe(18);
    expect(col("Primes soumises")).toBe(120);
    expect(col("Primes non soumises")).toBe(30);
    expect(col("Santé patronal")).toBe(147);
    expect(col("Retraite salarial")).toBe(144.9);
    expect(col("CSG/CRDS salarial")).toBe(140.3);
    expect(col("Exonérations patronal")).toBe(-210);
    expect(col("Réduction générale")).toBe(210);
    expect(col("Indemnités de frais et primes non soumises")).toBe(288);
    expect(col("Acomptes")).toBe(200);
    expect(col("Saisies, ATD, pensions")).toBe(50);
    expect(col("Autres retenues")).toBe(25);
    expect(col("Type de taux PAS")).toBe("Personnalisé");
    expect(col("Date de paiement")).toBe("30/09/2026");
    expect(col("Net payé")).toBe(1821.8);
  });

  it("salarié sans bulletin : identité et statut, montants vides", () => {
    const l = ligneComplete("2026-09", salaries[1]!, undefined);
    expect(l).toHaveLength(ENTETE_COMPLET.length);
    expect(l[ENTETE_COMPLET.indexOf("Statut du bulletin")]).toBe("Sans bulletin");
    expect(l[ENTETE_COMPLET.indexOf("Brut")]).toBeNull();
    expect(l[ENTETE_COMPLET.indexOf("Bulletin papier demandé")]).toBe(true);
  });

  it("le fichier exclut les salariés sortis sans bulletin et échappe les libellés", () => {
    const csv = csvComplet("2026-09", salaries, [b1]);
    const lignes = csv.split("\r\n").filter(Boolean);
    expect(lignes).toHaveLength(3);
    expect(csv).not.toContain("Ancien Salarié");
    expect(csv).toContain("2100,00");
    expect(detailPrimes(variables.primes)).toBe('Prime de nuit : 120,00 (soumise) | Indemnité outillage; "spéciale" : 30,00 (non soumise)');
    expect(csv).toContain('"Prime de nuit : 120,00 (soumise) | Indemnité outillage; ""spéciale"" : 30,00 (non soumise)"');
  });
});

describe("éléments variables", () => {
  it("reprend les entrées brutes et la source", () => {
    const csv = csvVariables("2026-09", [
      { salarie: salaries[0]!, variables, source: "Bulletin GODAC (validé)" },
      { salarie: salaries[1]!, variables: null, source: "Aucune donnée" },
    ]);
    const [entete, l1, l2] = csv.replace(BOM, "").split("\r\n");
    expect(entete!.split(";")).toEqual([...ENTETE_VARIABLES]);
    expect(l1).toContain("160,00");
    expect(l1).toContain("14/09/2026 au 15/09/2026 (2 j)");
    expect(l1).toContain("Saisie sur salaire : 50,00 (réf. RG 12/345)");
    expect(l2!.split(";")).toHaveLength(ENTETE_VARIABLES.length);
  });
});

describe("contrôles avant export", () => {
  it("non validés, sans bulletin, papier demandé", () => {
    const c = controlesExport(salaries, [b1]);
    expect(c.find((x) => x.message.startsWith("Bulletins en attente"))?.salaries).toEqual(["Martin Exemple"]);
    expect(c.find((x) => x.message.startsWith("Salariés actifs sans bulletin"))?.salaries).toEqual(["Durand Fictif"]);
    expect(c.find((x) => x.niveau === "info")?.salaries).toEqual(["Durand Fictif"]);
    expect(c.some((x) => x.message.startsWith("Écarts"))).toBe(false);
  });

  it("écart entre montant enregistré et détail", () => {
    const c = controlesExport(salaries, [{ ...b1, validation_status: "valide", net_amount: 1500 }]);
    expect(c.find((x) => x.message.startsWith("Écarts"))?.salaries).toEqual(["Martin Exemple"]);
    expect(c.some((x) => x.message.startsWith("Bulletins en attente"))).toBe(false);
  });

  it("bulletin indicatif sans détail", () => {
    const c = controlesExport(salaries, [{ ...b1, details: null }]);
    expect(c.some((x) => x.message.startsWith("Bulletins indicatifs"))).toBe(true);
  });
});
