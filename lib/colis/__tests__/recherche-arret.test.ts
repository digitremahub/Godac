import { describe, expect, it } from "vitest";
import { MIN_CARACTERES_AUTO, arretAAfficher, correspondA, suggestionValidee, termeRecherche } from "@/lib/colis/recherche-arret";

describe("recherche d'un arrêt", () => {
  it("normalise le terme et cherche dans toutes les valeurs", () => {
    expect(termeRecherche("  Rue DES Écoles ")).toBe("rue des écoles");
    expect(correspondA(["12 rue des Écoles", null], "écoles")).toBe(true);
    expect(correspondA(["Dupont", undefined], "martin")).toBe(false);
    expect(correspondA([], "")).toBe(true);
  });
  it("un seul résultat s'affiche directement une fois le terme assez long", () => {
    expect(arretAAfficher(["a"], "dup")).toBe("a");
    expect(arretAAfficher(["a"], "d".repeat(MIN_CARACTERES_AUTO - 1))).toBeNull();
  });
  it("plusieurs résultats ou aucun : rien d'office", () => {
    expect(arretAAfficher(["a", "b"], "dupont")).toBeNull();
    expect(arretAAfficher([], "dupont")).toBeNull();
    expect(arretAAfficher(["a"], "")).toBeNull();
  });
  it("Entrée sélectionne le premier résultat, même court ou parmi plusieurs", () => {
    expect(arretAAfficher(["a", "b"], "du", true)).toBe("a");
    expect(arretAAfficher([], "du", true)).toBeNull();
    expect(arretAAfficher(["a"], "", true)).toBeNull();
  });
  it("Entrée dans la saisie d'adresse : suggestion surlignée, sinon la première", () => {
    expect(suggestionValidee(2, 5)).toBe(2);
    expect(suggestionValidee(-1, 5)).toBe(0);
    expect(suggestionValidee(-1, 0)).toBe(-1);
    expect(suggestionValidee(7, 3)).toBe(0);
  });
});
