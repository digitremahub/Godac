import { describe, expect, it } from "vitest";
import { SEUIL_VARIATION_NET_POURCENT, anomaliesDuSalarie, comparerAvecMoisPrecedent, ecartPourcent, resumeLot, statutPreparation, variablesInitiales, type BulletinLu } from "@/lib/paie/lot";
import type { VariablesMois } from "@/lib/paie/types";

const bulletin = (net: number, extra: Partial<BulletinLu> = {}): BulletinLu => ({ net_amount: net, validation_status: "en_attente", variables: { heuresTravaillees: 150, primes: [] }, ...extra });
const entree = { userId: "u1", nom: "Marie", tauxHoraire: 12, aContrat: true, courant: null, precedent: null };
const codes = (e: Parameters<typeof anomaliesDuSalarie>[0]) => anomaliesDuSalarie(e).map((a) => a.code);

describe("statut", () => {
  it("à préparer / préparé / validé", () => {
    expect(statutPreparation(null)).toBe("a_preparer");
    expect(statutPreparation({ validation_status: "en_attente" })).toBe("prepare");
    expect(statutPreparation({ validation_status: "refuse" })).toBe("prepare");
    expect(statutPreparation({ validation_status: "valide" })).toBe("valide");
  });
});

describe("comparaison au mois précédent", () => {
  it("écarts de net, heures, primes en valeur et en %", () => {
    const l = comparerAvecMoisPrecedent({
      userId: "u1",
      nom: "Marie",
      courant: bulletin(1500, { variables: { heuresTravaillees: 160, primes: [{ libelle: "a", montant: 150, soumise: true }] } }),
      precedent: bulletin(1200, { variables: { heuresTravaillees: 150, primes: [{ libelle: "a", montant: 100, soumise: true }] } }),
    });
    expect(l.net).toMatchObject({ ecart: 300, pourcent: 25 });
    expect(l.heures.ecart).toBe(10);
    expect(l.primes).toMatchObject({ ecart: 50, pourcent: 50 });
  });
  it("précédent absent ou nul : pas de pourcentage", () => {
    expect(ecartPourcent(10, 0)).toBeNull();
    expect(ecartPourcent(10, null)).toBeNull();
  });
});

describe("anomalies", () => {
  it("taux horaire nul : bloquante", () => {
    const a = anomaliesDuSalarie({ ...entree, tauxHoraire: 0 });
    expect(a[0]).toMatchObject({ code: "taux_horaire_nul", gravite: "bloquante" });
  });
  it("salarié sans contrat", () => expect(codes({ ...entree, aContrat: false })).toContain("sans_contrat"));
  it("heures manquantes (bulletin préparé sans heures)", () => {
    expect(codes({ ...entree, courant: bulletin(1000, { variables: { heuresTravaillees: null, primes: [] } }) })).toContain("heures_manquantes");
    expect(codes({ ...entree, courant: bulletin(1000) })).not.toContain("heures_manquantes");
  });
  it("prime recopiée sans marqueur", () => {
    const c = bulletin(1000, { variables: { heuresTravaillees: 150, primes: [{ libelle: "P", montant: 50, soumise: true, recopiee: true }] } });
    expect(codes({ ...entree, courant: c })).toContain("prime_sans_marqueur");
  });
  it("net négatif", () => expect(codes({ ...entree, courant: bulletin(-20) })).toContain("net_negatif"));
  it(`variation du net > ${SEUIL_VARIATION_NET_POURCENT} %`, () => {
    expect(codes({ ...entree, courant: bulletin(1500), precedent: bulletin(1000) })).toContain("variation_net");
    expect(codes({ ...entree, courant: bulletin(1100), precedent: bulletin(1000) })).not.toContain("variation_net");
  });
});

describe("variablesInitiales et résumé", () => {
  const prefill = { heuresTravaillees: 151, heuresAbsenceNonPayee: 0, joursCongesPris: 2, primes: [{ libelle: "x", montant: 0, soumise: true }, { libelle: "y", montant: 20, soumise: true }], nbRepas: 10, nbRepasUnique: 0, nbCasseCroute: 0, nbGrandDeplacement: 0, cumulHeuresSupExonereesAnnee: 0 } as VariablesMois;
  it("reprend les valeurs préremplies, sans prime nulle, paiement par défaut", () => {
    const v = variablesInitiales(prefill, { subrogation: false }, "2026-10");
    expect(v.heuresTravaillees).toBe(151);
    expect(v.primes).toHaveLength(1);
    expect(v).toMatchObject({ datePaiement: "2026-10-31", modePaiement: "virement", heuresSup25: null });
  });
  it("résumé", () => expect(resumeLot({ prepares: 3, ignores: [{ userId: "a", nom: "A", raison: "" }], erreurs: [], restants: 0 })).toContain("3 bulletins préparés"));
});
