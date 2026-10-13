import { describe, expect, it } from "vitest";
import { arretsLivraison } from "@/lib/ocr/arrets";

describe("arrêts de livraison", () => {
  it("stops du scan moins les ramasses lues sur la feuille", () => {
    expect(arretsLivraison({ stops_scan: 61, pickups: 4 }, null)).toBe(57);
  });
  it("la saisie du chauffeur au retour fait foi", () => {
    expect(arretsLivraison({ stops_scan: 61, pickups: 4 }, { pickups: 6 })).toBe(55);
  });
  it("le total du compte-rendu de retour prime sur celui du départ", () => {
    expect(arretsLivraison({ stops_scan: 61 }, { stops_scan: 60, pickups: 5 })).toBe(55);
  });
  it("sans ramasse connue : total du scan", () => {
    expect(arretsLivraison({ stops_scan: 61 }, null)).toBe(61);
    expect(arretsLivraison(null, null)).toBeNull();
  });
  it("anciennes lectures (total brut dans stops_total)", () => {
    expect(arretsLivraison({ stops_total: 61, pickups: null }, { pickups: 6 })).toBe(55);
  });
});
