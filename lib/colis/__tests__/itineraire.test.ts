import { describe, expect, it } from "vitest";
import { ligneDroite, troncons } from "@/lib/colis/itineraire";

describe("itinéraire de la carte", () => {
  it("segments droits : distance routière estimée (×1,3)", () => {
    const it = ligneDroite([
      { lat: 45.75, lng: 4.85 },
      { lat: 45.76, lng: 4.85 },
    ]);
    expect(it.approx).toBe(true);
    expect(it.ligne).toEqual([
      [4.85, 45.75],
      [4.85, 45.76],
    ]);
    expect(it.distanceKm).toBeCloseTo(1.4, 1);
  });
  it("découpe en tronçons continus", () => {
    const t = troncons([1, 2, 3, 4, 5, 6, 7], 3);
    expect(t).toEqual([
      [1, 2, 3],
      [3, 4, 5],
      [5, 6, 7],
    ]);
    expect(troncons([1, 2], 3)).toEqual([[1, 2]]);
  });
});
