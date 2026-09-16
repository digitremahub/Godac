import { describe, expect, it } from "vitest";
import {
  computeRecoverableVat,
  filterTicpeEligibleVehicles,
  isTicpeEligible,
} from "../ticpe";

describe("isTicpeEligible", () => {
  it("is eligible for PL and SPL", () => {
    expect(isTicpeEligible("PL")).toBe(true);
    expect(isTicpeEligible("SPL")).toBe(true);
  });

  it("is never eligible for VL", () => {
    expect(isTicpeEligible("VL")).toBe(false);
  });
});

describe("filterTicpeEligibleVehicles", () => {
  it("strictly excludes VL from a mixed fleet", () => {
    const fleet = [
      { id: "1", type: "VL" as const },
      { id: "2", type: "PL" as const },
      { id: "3", type: "SPL" as const },
      { id: "4", type: "VL" as const },
    ];
    const eligible = filterTicpeEligibleVehicles(fleet);
    expect(eligible.map((v) => v.id)).toEqual(["2", "3"]);
  });

  it("returns an empty array for an all-VL fleet", () => {
    const fleet = [{ id: "1", type: "VL" as const }];
    expect(filterTicpeEligibleVehicles(fleet)).toEqual([]);
  });
});

describe("computeRecoverableVat", () => {
  it("recovers 80% of VAT for VL", () => {
    // 1000 EUR HT * 20% VAT = 200 EUR VAT, 80% recoverable = 160
    expect(
      computeRecoverableVat({ vehicleType: "VL", amountExclVat: 1000 }),
    ).toBe(160);
  });

  it("recovers 100% of VAT for PL and SPL", () => {
    expect(
      computeRecoverableVat({ vehicleType: "PL", amountExclVat: 1000 }),
    ).toBe(200);
    expect(
      computeRecoverableVat({ vehicleType: "SPL", amountExclVat: 1000 }),
    ).toBe(200);
  });
});
