import { describe, expect, it } from "vitest";
import { estimateExtraFuelLiters, estimateReturnDistanceDeltaKm, haversineDistanceKm } from "../fuel-profitability";

describe("haversineDistanceKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistanceKm({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8566, lng: 2.3522 })).toBe(0);
  });

  it("returns roughly the known distance between Paris and Lyon (~390km)", () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const lyon = { lat: 45.764, lng: 4.8357 };
    const distance = haversineDistanceKm(paris, lyon);
    expect(distance).toBeGreaterThan(380);
    expect(distance).toBeLessThan(400);
  });
});

describe("estimateReturnDistanceDeltaKm", () => {
  const depot = { lat: 48.8566, lng: 2.3522 };
  const home = { lat: 48.8666, lng: 2.3622 };

  it("is 0 when the driver returned to the depot", () => {
    expect(estimateReturnDistanceDeltaKm("depot", depot, home)).toBe(0);
  });

  it("is the depot-home distance when the driver went home", () => {
    const result = estimateReturnDistanceDeltaKm("domicile", depot, home);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(0);
  });

  it("is null when going home but the depot address isn't set", () => {
    expect(estimateReturnDistanceDeltaKm("domicile", null, home)).toBeNull();
  });

  it("is null when going home but the driver's address isn't set", () => {
    expect(estimateReturnDistanceDeltaKm("domicile", depot, null)).toBeNull();
  });

  it("is null when no return type was recorded yet", () => {
    expect(estimateReturnDistanceDeltaKm(null, depot, home)).toBeNull();
  });
});

describe("estimateExtraFuelLiters", () => {
  it("converts distance and L/100km into liters", () => {
    expect(estimateExtraFuelLiters(100, 30)).toBe(30);
    expect(estimateExtraFuelLiters(50, 25)).toBe(12.5);
  });

  it("is null when either input is missing or non-positive", () => {
    expect(estimateExtraFuelLiters(null, 30)).toBeNull();
    expect(estimateExtraFuelLiters(100, null)).toBeNull();
    expect(estimateExtraFuelLiters(100, 0)).toBeNull();
  });
});
