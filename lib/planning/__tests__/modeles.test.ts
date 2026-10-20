import { describe, expect, it } from "vitest";
import { basculerJour, JOURS_PAR_DEFAUT, nomModeleParDefaut, raisonGenerationImpossible, resumeJours } from "@/lib/planning/modeles";

describe("jours d'un modèle", () => {
  it("défaut : lundi → vendredi", () => {
    expect(resumeJours(JOURS_PAR_DEFAUT)).toBe("Lun–Ven");
  });
  it("cocher / décocher, sans doublon, trié", () => {
    expect(basculerJour([1, 2, 3, 4, 5], 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(basculerJour([1, 2, 3], 2)).toEqual([1, 3]);
    expect(basculerJour([5, 1, 1], 0)).toEqual([0, 1, 5]);
    expect(basculerJour([1], 9)).toEqual([1]);
  });
  it("résumé lisible", () => {
    expect(resumeJours([0, 1, 2, 3, 4, 5, 6])).toBe("Tous les jours");
    expect(resumeJours([1, 3, 6])).toBe("Lun, Mer, Sam");
    expect(resumeJours([5, 6, 0])).toBe("Ven–Dim");
    expect(resumeJours([6, 0])).toBe("Sam, Dim");
    expect(resumeJours([])).toBe("Aucun jour");
  });
});

describe("formulaire et génération", () => {
  it("nom proposé d'après la tournée", () => {
    expect(nomModeleParDefaut(" 12 ")).toBe("Tournée n°12");
    expect(nomModeleParDefaut(null)).toBe("");
  });
  it("explique pourquoi Générer est grisé", () => {
    const base = { serviceId: "s", chargement: false, generation: false, modeles: 2, coches: 1 };
    expect(raisonGenerationImpossible(base)).toBeNull();
    expect(raisonGenerationImpossible({ ...base, modeles: 0, coches: 0 })).toContain("+ Nouveau modèle");
    expect(raisonGenerationImpossible({ ...base, coches: 0 })).toBe("Cochez au moins un modèle à générer.");
    expect(raisonGenerationImpossible({ ...base, serviceId: "" })).toBe("Choisissez un service.");
  });
});
