import { describe, expect, it } from "vitest";
import { libellePalier, prixPalier, type PalierUtilisateurs } from "@/lib/organization/paliers";

const p = (min_users: number, max_users: number | null, monthly_price: number, extra_per_user = 0): PalierUtilisateurs => ({
  module_key: "route_optimizer",
  min_users,
  max_users,
  monthly_price,
  extra_per_user,
});
const grille = [p(1, 5, 29), p(6, 15, 59), p(16, 30, 99), p(31, 60, 179), p(61, 100, 279), p(101, null, 279, 2.5)];

describe("paliers d'utilisateurs", () => {
  it("prix selon le nombre de chauffeurs", () => {
    expect(prixPalier(grille, "route_optimizer", 0)).toBe(29);
    expect(prixPalier(grille, "route_optimizer", 5)).toBe(29);
    expect(prixPalier(grille, "route_optimizer", 6)).toBe(59);
    expect(prixPalier(grille, "route_optimizer", 30)).toBe(99);
    expect(prixPalier(grille, "route_optimizer", 100)).toBe(279);
  });
  it("palier ouvert : supplément par utilisateur au-delà", () => {
    expect(prixPalier(grille, "route_optimizer", 104)).toBe(279 + 4 * 2.5);
  });
  it("module sans grille", () => {
    expect(prixPalier(grille, "payslips", 10)).toBeNull();
  });
  it("libellés", () => {
    expect(libellePalier(grille[0]!)).toBe("jusqu'à 5 utilisateurs");
    expect(libellePalier(grille[1]!)).toBe("6 à 15 utilisateurs");
    expect(libellePalier(grille[5]!)).toBe("101 utilisateurs et plus");
  });
});
