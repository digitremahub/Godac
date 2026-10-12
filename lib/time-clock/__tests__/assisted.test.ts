import { describe, expect, it } from "vitest";
import { depotMatch } from "../assisted";

const depot = { lat: 42.6887, lng: 2.8948 }; // Perpignan

describe("depotMatch", () => {
  it("matches a precise fix inside the 300 m radius", () => {
    const m = depotMatch({ lat: 42.6897, lng: 2.8948 }, 20, [depot]); // ~111 m north
    expect(m).not.toBeNull();
    expect(m!.distanceM).toBeGreaterThan(90);
    expect(m!.distanceM).toBeLessThan(130);
  });

  it("ignores a fix outside the radius", () => {
    expect(depotMatch({ lat: 42.6987, lng: 2.8948 }, 20, [depot])).toBeNull(); // ~1.1 km
  });

  it("refuses an imprecise fix even if its center is at the depot", () => {
    expect(depotMatch(depot, 500, [depot])).toBeNull();
    expect(depotMatch(depot, null, [depot])).toBeNull();
  });

  it("picks the closest of several depots", () => {
    const far = { lat: 43.6, lng: 3.88 }; // Montpellier
    expect(depotMatch({ lat: 42.6889, lng: 2.8948 }, 10, [far, depot])?.distanceM).toBeLessThan(40);
  });

  it("returns null without any depot configured", () => {
    expect(depotMatch(depot, 10, [])).toBeNull();
  });
});
