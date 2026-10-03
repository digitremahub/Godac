import { describe, expect, it } from "vitest";
import { computeWeightedAveragePrice, isPriceAnomalous } from "../pmp";

describe("computeWeightedAveragePrice", () => {
  it("returns the entry's own price when the tank has no history", () => {
    const pmp = computeWeightedAveragePrice(
      { cumulativeLiters: 0, cumulativeAmount: 0, lastTrustedEntry: null },
      { liters: 400, unitPrice: 1.5 },
    );
    expect(pmp).toBe(1.5);
  });

  it("weights the new fill-up against prior cumulative volume", () => {
    // 1000 L @ 1.40 previously, now 400 L @ 1.60
    // (1000*1.40 + 400*1.60) / 1400 = (1400 + 640) / 1400 = 1.4571..
    const pmp = computeWeightedAveragePrice(
      { cumulativeLiters: 1000, cumulativeAmount: 1400, lastTrustedEntry: null },
      { liters: 400, unitPrice: 1.6 },
    );
    expect(pmp).toBe(1.4571);
  });

  it("rejects a non-positive liters value", () => {
    expect(() =>
      computeWeightedAveragePrice(
        { cumulativeLiters: 0, cumulativeAmount: 0, lastTrustedEntry: null },
        { liters: 0, unitPrice: 1.5 },
      ),
    ).toThrow();
  });
});

describe("isPriceAnomalous", () => {
  it("flags a price more than the threshold away from PMP", () => {
    expect(isPriceAnomalous(2.0, 1.5, 0.15)).toBe(true);
  });

  it("does not flag a price within the threshold", () => {
    expect(isPriceAnomalous(1.55, 1.5, 0.15)).toBe(false);
  });

  it("never flags when there is no PMP baseline yet", () => {
    expect(isPriceAnomalous(5, 0)).toBe(false);
  });
});
