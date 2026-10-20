import { describe, expect, it } from "vitest";
import { debutPeriode, joursFeries, joursOuvrables, paques, periodesDuMois, soldeConges, verdictDemandeConges } from "../conges";

describe("jours ouvrables", () => {
  it("lundi → samedi, hors dimanches et fériés", () => {
    expect(joursOuvrables("2026-09-01", "2026-09-04")).toBe(4); // mar → ven
    expect(joursOuvrables("2026-09-07", "2026-09-13")).toBe(6); // semaine complète
    expect(joursOuvrables("2026-11-09", "2026-11-14")).toBe(5); // 11 novembre
    expect(joursOuvrables("2026-09-05", "2026-09-01")).toBe(0);
  });
  it("Pâques et fériés mobiles", () => {
    expect(paques(2026)).toBe("2026-04-05");
    expect(joursFeries(2026).has("2026-05-25")).toBe(true); // lundi de Pentecôte
    expect(joursFeries(2026).has("2026-05-14")).toBe(true); // Ascension
  });
});

describe("soldeConges", () => {
  const reprise = { au: "2026-09-30", n1: 5, n: 5 };

  it("reprise du bulletin, puis 2,5 j par mois terminé", () => {
    const s = soldeConges({ reprise, aujourdhui: "2026-11-15", valides: [] });
    expect(s.n1).toEqual({ acquis: 5, pris: 0, solde: 5 });
    expect(s.n.acquis).toBe(7.5); // + octobre
    expect(s.disponible).toBe(12.5);
  });

  it("congés validés imputés sur N-1 puis N, demandes en attente", () => {
    const s = soldeConges({
      reprise,
      aujourdhui: "2026-11-15",
      valides: [{ du: "2026-10-05", au: "2026-10-10" }], // 6 jours
      enAttente: [{ du: "2026-12-21", au: "2026-12-24" }], // 4 jours
    });
    expect(s.n1).toEqual({ acquis: 5, pris: 5, solde: 0 });
    expect(s.n).toEqual({ acquis: 7.5, pris: 1, solde: 6.5 });
    expect(s.enAttente).toBe(4);
    expect(s.disponibleApresAttente).toBe(2.5);
  });

  it("un congé validé avant la reprise est déjà dans le solde", () => {
    const s = soldeConges({ reprise, aujourdhui: "2026-10-10", valides: [{ du: "2026-09-01", au: "2026-09-04" }] });
    expect(s.n1.pris + s.n.pris).toBe(0);
  });

  it("bascule au 1er juin : N devient N-1", () => {
    const s = soldeConges({ reprise, aujourdhui: "2027-06-10", valides: [] });
    // N : 5 + 8 mois (oct → mai) × 2,5 = 25 ; reliquat N-1 de 5 reporté.
    expect(s.n1.acquis).toBe(30);
    expect(s.n.acquis).toBe(0);
    expect(s.periodeN).toBe("2027-06-01");
  });

  it("sans reprise : zéro au 1er juin", () => {
    const s = soldeConges({ reprise: null, aujourdhui: "2026-09-15", valides: [] });
    expect(s.n.acquis).toBe(7.5); // juin, juillet, août
    expect(s.repriseRenseignee).toBe(false);
    expect(debutPeriode("2026-05-31")).toBe("2025-06-01");
  });
});

describe("verdictDemandeConges", () => {
  it("solde après demande, ou solde insuffisant", () => {
    expect(verdictDemandeConges({ disponibleApresAttente: 10 }, "2026-12-21", "2026-12-24")).toMatchObject({ jours: 4, soldeApres: 6, insuffisant: false });
    const v = verdictDemandeConges({ disponibleApresAttente: 2 }, "2026-12-21", "2026-12-24");
    expect(v.insuffisant).toBe(true);
    expect(v.message).toMatch(/Solde insuffisant/);
  });
});

describe("periodesDuMois", () => {
  it("coupe aux bornes du mois", () => {
    expect(periodesDuMois([{ du: "2026-08-28", au: "2026-09-04" }], "2026-09-01", "2026-09-30")).toEqual([{ du: "2026-09-01", au: "2026-09-04", jours: 4 }]);
  });
});
