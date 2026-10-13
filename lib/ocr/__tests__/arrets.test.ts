import { describe, expect, it } from "vitest";
import { arretsLivraison } from "@/lib/ocr/arrets";

describe("arrêts de livraison", () => {
  it("prend le compte-rendu de retour s'il porte les stops", () => {
    expect(arretsLivraison({ stops_total: 61, pickups: null }, { stops_total: 55, pickups: 6 })).toBe(55);
  });
  it("déduit les ramasses connues au retour du total lu au départ", () => {
    expect(arretsLivraison({ stops_total: 61, pickups: null }, { pickups: 6 })).toBe(55);
  });
  it("ne déduit pas deux fois si le départ portait déjà les ramasses", () => {
    expect(arretsLivraison({ stops_total: 55, pickups: 6 }, { pickups: 6 })).toBe(55);
  });
  it("sans retour : total du départ", () => {
    expect(arretsLivraison({ stops_total: 61 }, null)).toBe(61);
    expect(arretsLivraison(null, null)).toBeNull();
  });
});
