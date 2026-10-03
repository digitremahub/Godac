import { describe, expect, it } from "vitest";
import { computeConsumptionLPer100Km, computeKmTraveled, detectConsumptionAnomaly } from "../consumption";

describe("computeKmTraveled", () => {
  it("returns null with fewer than two readings", () => {
    expect(computeKmTraveled([])).toBeNull();
    expect(computeKmTraveled([{ at: "2026-01-01", km: 1000 }])).toBeNull();
  });

  it("computes the delta between the earliest and latest reading by date", () => {
    expect(
      computeKmTraveled([
        { at: "2026-01-10", km: 1500 },
        { at: "2026-01-01", km: 1000 },
      ]),
    ).toBe(500);
  });

  it("ignores reading order in the input, sorting by date itself", () => {
    expect(
      computeKmTraveled([
        { at: "2026-01-01", km: 1000 },
        { at: "2026-01-15", km: 1800 },
        { at: "2026-01-10", km: 1500 },
      ]),
    ).toBe(800);
  });

  it("returns null on a non-positive delta (bad/regressive data)", () => {
    expect(
      computeKmTraveled([
        { at: "2026-01-01", km: 1000 },
        { at: "2026-01-10", km: 900 },
      ]),
    ).toBeNull();
  });
});

describe("computeConsumptionLPer100Km", () => {
  it("computes liters per 100km", () => {
    expect(computeConsumptionLPer100Km(30, 1000)).toBe(3);
  });

  it("returns null when km traveled is unknown", () => {
    expect(computeConsumptionLPer100Km(30, null)).toBeNull();
  });

  it("returns null when km traveled is zero or negative", () => {
    expect(computeConsumptionLPer100Km(30, 0)).toBeNull();
  });
});

describe("detectConsumptionAnomaly", () => {
  it("flags a vehicle consuming more than 20% above its own baseline", () => {
    const result = detectConsumptionAnomaly(40, 30, 5);
    expect(result.anomaly).toBe(true);
    expect(result.deviationPercent).toBeCloseTo(33.3, 1);
  });

  it("does not flag a vehicle within the threshold", () => {
    expect(detectConsumptionAnomaly(33, 30, 5).anomaly).toBe(false);
  });

  it("never flags with fewer fill-ups than the minimum", () => {
    expect(detectConsumptionAnomaly(50, 30, 2).anomaly).toBe(false);
  });

  it("never flags without a baseline to compare against", () => {
    expect(detectConsumptionAnomaly(50, null, 5).anomaly).toBe(false);
  });
});
