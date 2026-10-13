import { describe, expect, it } from "vitest";
import { libellePalier, prixPalier, type PalierUtilisateurs } from "@/lib/organization/paliers";

const p = (min_users: number, max_users: number | null, monthly_price: number, extra_per_user = 0): PalierUtilisateurs => ({
  module_key: "route_optimizer",
  min_users,
  max_users,
  monthly_price,
  extra_per_user,
});
const grille = [p(1, 20, 29), p(21, 50, 59), p(51, 99, 99), p(100, null, 129, 1)];

describe("paliers d'utilisateurs", () => {
  it("prix selon le nombre de chauffeurs", () => {
    expect(prixPalier(grille, "route_optimizer", 0)).toBe(29);
    expect(prixPalier(grille, "route_optimizer", 20)).toBe(29);
    expect(prixPalier(grille, "route_optimizer", 21)).toBe(59);
    expect(prixPalier(grille, "route_optimizer", 50)).toBe(59);
    expect(prixPalier(grille, "route_optimizer", 51)).toBe(99);
    expect(prixPalier(grille, "route_optimizer", 99)).toBe(99);
  });
  it("100 et plus : 129 € + 1 € par chauffeur au-delà de 100", () => {
    expect(prixPalier(grille, "route_optimizer", 100)).toBe(129);
    expect(prixPalier(grille, "route_optimizer", 101)).toBe(130);
    expect(prixPalier(grille, "route_optimizer", 125)).toBe(154);
  });
  it("module sans grille", () => {
    expect(prixPalier(grille, "payslips", 10)).toBeNull();
  });
  it("libellés", () => {
    expect(libellePalier(grille[0]!)).toBe("jusqu'à 20 utilisateurs");
    expect(libellePalier(grille[1]!)).toBe("21 à 50 utilisateurs");
    expect(libellePalier(grille[3]!)).toBe("100 utilisateurs et plus");
  });
});
