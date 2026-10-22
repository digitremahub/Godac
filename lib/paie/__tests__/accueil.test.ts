import { describe, expect, it } from "vitest";
import { bulletinsAValider, resumeBulletinsMois, suiteMoisPaie, valeurBulletinsMois } from "@/lib/paie/accueil";

describe("tuile « Bulletins à valider » de la direction", () => {
  it("compte les bulletins en attente, tous mois confondus, et vise le plus ancien mois", () => {
    const lignes = [
      { period_start: "2026-10-01", validation_status: "en_attente" },
      { period_start: "2026-09-01", validation_status: "en_attente" },
      { period_start: "2026-10-01", validation_status: "valide" },
      { period_start: "2026-10-01", validation_status: "refuse" },
    ];
    expect(bulletinsAValider(lignes)).toEqual({ nombre: 2, mois: "2026-09" });
    expect(bulletinsAValider([])).toEqual({ nombre: 0, mois: null });
  });

  it("lien : mois en cours sans paramètre, sinon ?mois=", () => {
    expect(suiteMoisPaie("2026-10", "2026-10")).toBe("");
    expect(suiteMoisPaie("2026-09", "2026-10")).toBe("?mois=2026-09");
    expect(suiteMoisPaie(null, "2026-10")).toBe("");
  });
});

describe("tuile « Bulletins du mois » du comptable", () => {
  it("préparés / salariés, et refusés à corriger", () => {
    const r = resumeBulletinsMois([
      { period_start: "2026-10-01", validation_status: "valide" },
      { period_start: "2026-10-01", validation_status: "en_attente" },
      { period_start: "2026-10-01", validation_status: "refuse" },
      { period_start: "2026-10-01", validation_status: null },
    ]);
    expect(r).toEqual({ prepares: 4, valides: 1, enAttente: 2, refuses: 1 });
    expect(valeurBulletinsMois(r, 12)).toBe("4 / 12 · 1 à corriger");
    expect(valeurBulletinsMois({ prepares: 3, valides: 3, enAttente: 0, refuses: 0 }, 3)).toBe("3 / 3");
  });
});
