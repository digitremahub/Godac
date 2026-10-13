import { describe, expect, it } from "vitest";
import { fuelEntryPayload, parseDecimal, validateFuelEntryValues, type FuelEntryFormValues } from "../entry-payload";

function values(overrides: Partial<FuelEntryFormValues> = {}): FuelEntryFormValues {
  return {
    occurred_at: "2026-07-14T09:05",
    totalizer_before: "",
    totalizer_after: "",
    totalizer_before_photo_path: "",
    totalizer_after_photo_path: "",
    vehicle_km: "",
    liters: "",
    unit_price: "",
    station_name: "",
    product: "gazole",
    ...overrides,
  };
}

describe("parseDecimal", () => {
  it("vide → null, jamais 0", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("  ")).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("1,789")).toBe(1.789);
    expect(parseDecimal("0")).toBe(0);
  });
});

describe("validateFuelEntryValues", () => {
  it("station : litres et prix > 0 obligatoires", () => {
    expect(validateFuelEntryValues(values({ liters: "50" }), true)).toMatch(/prix/);
    expect(validateFuelEntryValues(values({ liters: "50", unit_price: "0" }), true)).toMatch(/prix/);
    expect(validateFuelEntryValues(values({ unit_price: "1.8" }), true)).toMatch(/litres/);
    expect(validateFuelEntryValues(values({ liters: "50", unit_price: "1.8" }), true)).toBeNull();
  });

  it("station : aucun totaliseur demandé", () => {
    expect(validateFuelEntryValues(values({ liters: "50", unit_price: "1.8", totalizer_after: "" }), true)).toBeNull();
  });

  it("cuve : totaliseur après obligatoire et supérieur à l'avant", () => {
    expect(validateFuelEntryValues(values(), false)).toMatch(/totaliseur/);
    expect(validateFuelEntryValues(values({ totalizer_before: "100", totalizer_after: "90" }), false)).toMatch(/supérieur/);
    expect(validateFuelEntryValues(values({ totalizer_before: "100", totalizer_after: "150" }), false)).toBeNull();
  });

  it("date absente", () => {
    expect(validateFuelEntryValues(values({ occurred_at: "", liters: "1", unit_price: "1" }), true)).toMatch(/date/);
  });
});

describe("fuelEntryPayload", () => {
  it("station en POST : ni cuve ni totaliseur", () => {
    const p = fuelEntryPayload(values({ liters: "50", unit_price: "1.8", product: "adblue", station_name: " Total " }), {
      station: true,
      method: "POST",
    });
    expect(p).not.toHaveProperty("tank_id");
    expect(p).not.toHaveProperty("totalizer_after");
    expect(p).toMatchObject({ liters: 50, unit_price: 1.8, product: "adblue", station_name: "Total" });
    expect(p.occurred_at).toBe(new Date(2026, 6, 14, 9, 5).toISOString());
  });

  it("station en PATCH : détache la cuve", () => {
    const p = fuelEntryPayload(values({ liters: "50", unit_price: "1.8", totalizer_after: "1234" }), { station: true, method: "PATCH" });
    expect(p.tank_id).toBeNull();
    expect(p).not.toHaveProperty("totalizer_after");
    expect(p.station_name).toBeNull();
  });

  it("cuve : un champ vide n'est jamais envoyé comme 0", () => {
    const p = fuelEntryPayload(values({ totalizer_after: "", unit_price: "" }), { station: false, method: "PATCH" });
    expect(p.totalizer_after).toBeUndefined();
    expect(p.totalizer_before).toBeNull();
    expect(p).not.toHaveProperty("unit_price");
    expect(p).not.toHaveProperty("liters");
    expect(p.vehicle_km).toBeUndefined();
  });

  it("cuve : totaliseur et km transmis", () => {
    const p = fuelEntryPayload(values({ totalizer_before: "100", totalizer_after: "150.5", vehicle_km: "123456" }), {
      station: false,
      method: "POST",
    });
    expect(p).toMatchObject({ totalizer_before: 100, totalizer_after: 150.5, vehicle_km: 123456 });
  });
});
