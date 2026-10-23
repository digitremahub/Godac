import { describe, expect, it } from "vitest";
import { decrireModification, estAvantApres } from "@/lib/audit/avant-apres";
import { declarationDuJour, ecartAvecDeclaration, ecartsDeclarations, messagePeriodeDeclaree, modifieLeMontantTicpe } from "@/lib/ticpe/regularisation";

describe("écart calculé / déclaré", () => {
  it("scénario de l'audit : déclaré 4 362,00 €, recalculé 4 206,40 € après correction de 1 000 L", () => {
    const e = ecartAvecDeclaration(4362, 4206.4);
    expect(e).toMatchObject({ ecart: -155.6, aRegulariser: true });
    expect(e.message).toContain("calculé ≠ déclaré");
    expect(e.message).toContain("155,60");
    expect(e.message).toContain("à régulariser");
  });
  it("écart positif (plein ajouté après la déclaration)", () => {
    expect(ecartAvecDeclaration(1000, 1046.68).message).toContain("+");
  });
  it("même montant ou simple arrondi d'un centime : rien à régulariser", () => {
    expect(ecartAvecDeclaration(4362, 4362)).toEqual({ ecart: 0, aRegulariser: false, message: null });
    expect(ecartAvecDeclaration(4362, 4362.004).aRegulariser).toBe(false);
    expect(ecartAvecDeclaration(4362, 4362.01).aRegulariser).toBe(true);
  });
  it("par déclaration : annulées et périodes non calculées ignorées", () => {
    const decls = [
      { id: "a", montant: 100, periode_debut: "2026-01-01", periode_fin: "2026-01-31" },
      { id: "b", montant: 100, periode_debut: "2026-02-01", periode_fin: "2026-02-28", annulee_le: "2026-03-01" },
      { id: "c", montant: 100, periode_debut: "2023-01-01", periode_fin: "2023-01-31" },
      { id: "d", montant: 50, periode_debut: "2026-03-01", periode_fin: "2026-03-31" },
    ];
    const m = ecartsDeclarations(decls, (d) => (d.id === "c" ? null : d.id === "d" ? 50 : 90));
    expect([...m.keys()]).toEqual(["a", "d"]);
    expect(m.get("a")).toMatchObject({ ecart: -10, aRegulariser: true });
    expect(m.get("d")!.aRegulariser).toBe(false);
  });
});

describe("plein d'une période déclarée", () => {
  const decls = [
    { periode_debut: "2026-03-01", periode_fin: "2026-03-31", periode_libelle: "mars 2026", declaree_le: "2026-04-18" },
    { periode_debut: "2026-04-01", periode_fin: "2026-04-30", annulee_le: "2026-05-02" },
  ];
  it("jour couvert par une déclaration non annulée", () => {
    expect(declarationDuJour("2026-03-31", decls)).toBe(decls[0]);
    expect(declarationDuJour("2026-04-01", decls)).toBeNull();
    expect(declarationDuJour("2026-04-15", decls)).toBeNull();
  });
  it("seuls certains champs changent le montant", () => {
    expect(modifieLeMontantTicpe({ liters: 250 })).toBe(true);
    expect(modifieLeMontantTicpe({ occurred_at: "2026-03-01T00:00:00Z" })).toBe(true);
    expect(modifieLeMontantTicpe({ ticpe_zone: "corse" })).toBe(true);
    expect(modifieLeMontantTicpe({ unit_price: 1.7, station_name: "X", vehicle_km: 100 })).toBe(false);
  });
  it("message d'avertissement", () => {
    const m = messagePeriodeDeclaree(decls[0]!);
    expect(m).toContain("mars 2026");
    expect(m).toContain("18/04/2026");
    expect(m).toContain("régularisée");
  });
});

describe("journal : format avant / après", () => {
  const lib = (k: string) => (k === "liters" ? "Litres" : k);
  const val = (_k: string, v: unknown) => (v === null ? "—" : String(v));
  it("reconnaît le format et l'ancien format", () => {
    expect(estAvantApres({ avant: { liters: 300 }, apres: { liters: 250 } })).toBe(true);
    expect(estAvantApres({ liters: 250 })).toBe(false);
    expect(estAvantApres(null)).toBe(false);
  });
  it("phrase lisible : ancienne valeur → nouvelle valeur", () => {
    expect(decrireModification({ avant: { liters: 300 }, apres: { liters: 250 } }, lib, val)).toBe("Litres : 300 → 250");
  });
  it("ancien format : nouvelles valeurs seules", () => {
    expect(decrireModification({ liters: 250, periode_declaree: "mars 2026" }, lib, val)).toBe("Litres : 250");
  });
});
