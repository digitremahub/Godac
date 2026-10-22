import { describe, expect, it } from "vitest";
import {
  argentNonReclame,
  dateLimite,
  dateLimiteCa12ParDefaut,
  dateLimiteReclamation,
  encoreReclamable,
  estDeclaree,
  joursEntre,
  libelleMois,
  moisDeLaPeriode,
  periodeContenant,
  periodePrecedente,
  periodesReclamables,
  periodeSuivante,
  prochaineEcheance,
  rappelEra,
} from "@/lib/ticpe/echeances";
import { REGLAGES_PAR_DEFAUT } from "@/lib/ticpe/reglages";

const R = REGLAGES_PAR_DEFAUT;

describe("périodes de déclaration", () => {
  it("mensuelle", () => {
    expect(periodeContenant("2026-02-14", "mensuel")).toEqual({ cle: "2026-02", debut: "2026-02-01", fin: "2026-02-28", libelle: "février 2026" });
    expect(periodeContenant("2028-02-29", "mensuel").fin).toBe("2028-02-29");
  });
  it("trimestrielle", () => {
    expect(periodeContenant("2026-05-20", "trimestriel")).toEqual({ cle: "2026-T2", debut: "2026-04-01", fin: "2026-06-30", libelle: "2e trimestre 2026" });
    expect(periodeContenant("2026-01-01", "trimestriel").libelle).toBe("1er trimestre 2026");
    expect(periodeContenant("2026-12-31", "trimestriel").cle).toBe("2026-T4");
  });
  it("annuelle (CA12)", () => {
    expect(periodeContenant("2026-07-01", "annuel_ca12")).toEqual({ cle: "2026", debut: "2026-01-01", fin: "2026-12-31", libelle: "année 2026" });
  });
  it("précédente / suivante, passage d'année", () => {
    expect(periodePrecedente(periodeContenant("2026-01-10", "mensuel"), "mensuel").cle).toBe("2025-12");
    expect(periodeSuivante(periodeContenant("2026-11-10", "trimestriel"), "trimestriel").cle).toBe("2027-T1");
    expect(periodePrecedente(periodeContenant("2026-06-10", "annuel_ca12"), "annuel_ca12").cle).toBe("2025");
  });
});

describe("dates limites", () => {
  it("CA3 : fin du mois suivant par défaut", () => {
    expect(dateLimite(periodeContenant("2026-01-15", "mensuel"), "mensuel", R)).toBe("2026-02-28");
    expect(dateLimite(periodeContenant("2026-12-15", "mensuel"), "mensuel", R)).toBe("2027-01-31");
    expect(dateLimite(periodeContenant("2026-02-15", "trimestriel"), "trimestriel", R)).toBe("2026-04-30");
  });
  it("CA3 : jour réglé, borné à la fin du mois", () => {
    expect(dateLimite(periodeContenant("2026-03-15", "mensuel"), "mensuel", { ...R, jour_limite_depot: 19 })).toBe("2026-04-19");
    expect(dateLimite(periodeContenant("2026-01-15", "mensuel"), "mensuel", { ...R, jour_limite_depot: 31 })).toBe("2026-02-28");
  });
  it("CA12 : 2e jour ouvré après le 1er mai, ou date réglée", () => {
    expect(dateLimiteCa12ParDefaut(2027)).toBe("2027-05-04"); // 1er mai samedi : lundi 3, mardi 4
    expect(dateLimiteCa12ParDefaut(2026)).toBe("2026-05-05"); // 1er mai vendredi : lundi 4, mardi 5
    expect(dateLimite(periodeContenant("2026-06-01", "annuel_ca12"), "annuel_ca12", R)).toBe("2027-05-04");
    expect(dateLimite(periodeContenant("2026-06-01", "annuel_ca12"), "annuel_ca12", { ...R, date_limite_ca12: "05-15" })).toBe("2027-05-15");
  });
  it("prochaine échéance : période précédente tant que sa date limite n'est pas passée", () => {
    expect(prochaineEcheance("2026-10-22", R)).toMatchObject({ periode: { cle: "2026-09" }, dateLimite: "2026-10-31", joursRestants: 9 });
    expect(prochaineEcheance("2026-10-22", { ...R, jour_limite_depot: 19 })).toMatchObject({ periode: { cle: "2026-10" }, dateLimite: "2026-11-19" });
    expect(prochaineEcheance("2026-10-22", { ...R, regime_tva: "trimestriel" })).toMatchObject({ periode: { cle: "2026-T3" }, dateLimite: "2026-10-31" });
    expect(prochaineEcheance("2026-10-22", { ...R, regime_tva: "annuel_ca12" })).toMatchObject({ periode: { cle: "2026" }, dateLimite: "2027-05-04" });
    expect(prochaineEcheance("2026-03-01", { ...R, regime_tva: "annuel_ca12" })).toMatchObject({ periode: { cle: "2025" }, dateLimite: "2026-05-05" });
  });
  it("jours entre deux dates", () => {
    expect(joursEntre("2026-10-22", "2026-10-31")).toBe(9);
    expect(joursEntre("2026-03-28", "2026-03-30")).toBe(2);
  });
});

describe("délai de réclamation et argent non réclamé", () => {
  it("consommations 2026 réclamables jusqu'au 31/12/2028", () => {
    expect(dateLimiteReclamation(2026)).toBe("2028-12-31");
    expect(encoreReclamable(periodeContenant("2026-01-01", "mensuel"), "2028-12-31")).toBe(true);
    expect(encoreReclamable(periodeContenant("2026-12-01", "mensuel"), "2029-01-01")).toBe(false);
  });
  it("périodes réclamables : terminées, depuis 2025 au plus tôt", () => {
    const p = periodesReclamables("2026-03-10", "mensuel");
    expect(p[0]!.cle).toBe("2025-01");
    expect(p.at(-1)!.cle).toBe("2026-02");
    expect(p).toHaveLength(14);
    expect(periodesReclamables("2029-02-01", "trimestriel")[0]!.cle).toBe("2027-T1");
    expect(periodesReclamables("2026-03-10", "annuel_ca12").map((x) => x.cle)).toEqual(["2025"]);
  });
  it("périodes déclarées exclues, montants nuls ignorés", () => {
    const montants: Record<string, number> = { "2026-01": 120.5, "2026-02": 80, "2026-03": 0 };
    const r = argentNonReclame((p) => montants[p.cle] ?? 0, [{ periode_debut: "2026-02-01", periode_fin: "2026-02-28" }], "2026-04-15", "mensuel");
    expect(r.periodes.map((x) => x.periode.cle)).toEqual(["2026-01"]);
    expect(r.total).toBe(120.5);
    expect(r.periodes[0]!.dateLimiteReclamation).toBe("2028-12-31");
  });
  it("une déclaration annulée ne compte plus ; une déclaration plus large couvre la période", () => {
    expect(estDeclaree({ debut: "2026-02-01", fin: "2026-02-28" }, [{ periode_debut: "2026-02-01", periode_fin: "2026-02-28", annulee_le: "2026-03-01" }])).toBe(false);
    expect(estDeclaree({ debut: "2026-02-01", fin: "2026-02-28" }, [{ periode_debut: "2026-01-01", periode_fin: "2026-03-31" }])).toBe(true);
    expect(estDeclaree({ debut: "2026-01-01", fin: "2026-03-31" }, [{ periode_debut: "2026-02-01", periode_fin: "2026-02-28" }])).toBe(false);
  });
});

describe("divers", () => {
  it("mois d'une période", () => {
    expect(moisDeLaPeriode({ debut: "2026-11-01", fin: "2027-01-31" })).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(libelleMois("2026-03")).toBe("mars 2026");
  });
  it("rappel ERA en janvier seulement", () => {
    expect(rappelEra("2027-01-10")).toEqual({ annee: 2026, dateLimite: "2027-01-31" });
    expect(rappelEra("2027-02-01")).toBeNull();
  });
});
