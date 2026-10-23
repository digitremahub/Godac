import { describe, expect, it } from "vitest";
import { avertissementDocument, evaluerGeneration, mentionPointsNonResolus, nombreBloquants } from "@/lib/ticpe/bloquants";

const b = { gravite: "bloquant" as const };
const a = { gravite: "avertissement" as const };

describe("génération des documents et points bloquants", () => {
  it("aucun point bloquant : génération libre, sans mention", () => {
    expect(evaluerGeneration([a, a])).toEqual({ statut: "ok", pointsNonResolus: 0, force: false });
    expect(evaluerGeneration([])).toEqual({ statut: "ok", pointsNonResolus: 0, force: false });
  });
  it("des points bloquants : refusée sans confirmation, avec leur nombre", () => {
    const d = evaluerGeneration([b, a, b, b]);
    expect(nombreBloquants([b, a, b, b])).toBe(3);
    expect(d).toMatchObject({ statut: "bloque", bloquants: 3 });
    expect((d as { message: string }).message).toContain("3 points bloquants");
  });
  it("un seul point : accord au singulier", () => {
    expect((evaluerGeneration([b]) as { message: string }).message).toContain("1 point bloquant à régler");
  });
  it("confirmation du bon nombre : accordée et marquée forcée", () => {
    expect(evaluerGeneration([b, b], 2)).toEqual({ statut: "ok", pointsNonResolus: 2, force: true });
  });
  it("confirmation périmée (le nombre a changé) : refusée de nouveau", () => {
    const d = evaluerGeneration([b, b, b], 2);
    expect(d).toMatchObject({ statut: "bloque", bloquants: 3 });
    expect((d as { message: string }).message).toContain("a changé");
  });
  it("une confirmation n'a pas d'effet s'il n'y a rien de bloquant", () => {
    expect(evaluerGeneration([a], 4)).toEqual({ statut: "ok", pointsNonResolus: 0, force: false });
  });
  it("mention « N points non résolus » sur le document forcé", () => {
    expect(mentionPointsNonResolus(0)).toBe("");
    expect(mentionPointsNonResolus(1)).toContain("1 point non résolu");
    expect(mentionPointsNonResolus(3)).toContain("3 points non résolus");
    expect(avertissementDocument("Texte habituel.", 0)).toBe("Texte habituel.");
    const w = avertissementDocument("Texte habituel.", 3);
    expect(w.startsWith("ATTENTION : 3 points non résolus")).toBe(true);
    expect(w.endsWith("Texte habituel.")).toBe(true);
  });
});
