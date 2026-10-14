import { describe, expect, it } from "vitest";
import { extrairePoids, formatPoids, lirePoids, sommePoids } from "@/lib/colis/poids";

describe("poids du colis", () => {
  it("lit un nombre ou un texte en kg, convertit les grammes", () => {
    expect(lirePoids(2.5)).toBe(2.5);
    expect(lirePoids("2,5 kg")).toBe(2.5);
    expect(lirePoids("1.2 KGS")).toBe(1.2);
    expect(lirePoids("3")).toBe(3);
    expect(lirePoids("850 g")).toBe(0.85);
    expect(lirePoids("1 250 g")).toBe(1.25);
    expect(lirePoids("850gr")).toBe(0.85);
  });
  it("refuse les valeurs absentes ou aberrantes", () => {
    expect(lirePoids(null)).toBeNull();
    expect(lirePoids("")).toBeNull();
    expect(lirePoids(0)).toBeNull();
    expect(lirePoids(-1)).toBeNull();
    expect(lirePoids(20_000)).toBeNull();
    expect(lirePoids("lourd")).toBeNull();
    expect(lirePoids(Number.NaN)).toBeNull();
  });
  it("extrait le poids d'un texte d'étiquette", () => {
    expect(extrairePoids("MARTIN Julie\nPoids : 2,3 kg\n12 rue des Lilas")).toBe(2.3);
    expect(extrairePoids("Weight 850 g")).toBe(0.85);
    expect(extrairePoids("12 rue des Lilas, 69230 Saint-Genis-Laval")).toBeNull();
  });
  it("affiche et totalise", () => {
    expect(formatPoids(2.5)).toBe("2,5 kg");
    expect(formatPoids("0.850")).toBe("0,85 kg");
    expect(formatPoids(12.345)).toBe("12,3 kg");
    expect(formatPoids(null)).toBeNull();
    expect(sommePoids([{ weight_kg: 1.5 }, { weight_kg: null }, { weight_kg: "2.25" }, {}])).toBe(3.75);
    expect(sommePoids([{ weight_kg: null }, {}])).toBeNull();
  });
});
