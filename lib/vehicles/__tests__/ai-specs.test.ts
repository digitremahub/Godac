import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { aiVehicleSpecsSchema } from "@/lib/vehicles/ai-specs";
import { isTicpeSafeToInclude } from "@/lib/business/ticpe";

function validToolInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: { value: "PL", confidence: "élevé" },
    fuel_type: { value: "diesel", confidence: "élevé" },
    tank_capacity_liters: { value: 400, confidence: "moyen" },
    adblue_capacity_liters: { value: 40, confidence: "moyen" },
    ptac_kg: { value: 19000, confidence: "élevé" },
    reference_consumption_l_100km: { value: 28, confidence: "faible" },
    variants: [],
    ...overrides,
  };
}

describe("aiVehicleSpecsSchema", () => {
  it("accepts a well-formed tool response", () => {
    const result = aiVehicleSpecsSchema.safeParse(validToolInput());
    expect(result.success).toBe(true);
  });

  it("accepts null values for fields the model doesn't know", () => {
    const result = aiVehicleSpecsSchema.safeParse(
      validToolInput({
        tank_capacity_liters: { value: null, confidence: null },
        adblue_capacity_liters: { value: null, confidence: null },
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tank_capacity_liters.value).toBeNull();
    }
  });

  it("accepts variants when the model is ambiguous", () => {
    const result = aiVehicleSpecsSchema.safeParse(
      validToolInput({
        variants: [
          { label: "Version courte", tank_capacity_liters: 300, ptac_kg: 18000 },
          { label: "Version longue", tank_capacity_liters: 400, ptac_kg: 19000 },
        ],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.variants).toHaveLength(2);
    }
  });

  it("rejects a malformed response (missing required field)", () => {
    const { type: _omit, ...rest } = validToolInput();
    const result = aiVehicleSpecsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid vehicle type enum value", () => {
    const result = aiVehicleSpecsSchema.safeParse(validToolInput({ type: { value: "CAMIONNETTE", confidence: "élevé" } }));
    expect(result.success).toBe(false);
  });

  it("rejects a negative number for a positive-only field", () => {
    const result = aiVehicleSpecsSchema.safeParse(validToolInput({ ptac_kg: { value: -10, confidence: "élevé" } }));
    expect(result.success).toBe(false);
  });
});

describe("isTicpeSafeToInclude (TICPE guard rail on AI-estimated type)", () => {
  it("includes a vehicle whose type was typed in manually", () => {
    expect(isTicpeSafeToInclude("PL", { type: { origin: "saisie", confirmed: false } })).toBe(true);
  });

  it("includes a vehicle whose AI-estimated type has been confirmed", () => {
    expect(isTicpeSafeToInclude("PL", { type: { origin: "ia", confirmed: true } })).toBe(true);
  });

  it("excludes a vehicle whose AI-estimated type has not been confirmed", () => {
    expect(isTicpeSafeToInclude("PL", { type: { origin: "ia", confirmed: false } })).toBe(false);
  });

  it("includes a vehicle with no spec_sources entry for type (pre-Lot-A data)", () => {
    expect(isTicpeSafeToInclude("PL", {})).toBe(true);
  });
});
