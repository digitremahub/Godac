import { describe, expect, it } from "vitest";
import { bornesPeriode, eligibiliteTicpe, minuitParis } from "@/lib/ticpe/export";

describe("éligibilité TICPE", () => {
  it("PL/SPL gazole avec PTAC ≥ 7,5 t inclus", () => {
    expect(eligibiliteTicpe({ type: "PL", ptac_kg: 19000, fuel_type: "Diesel" })).toEqual({ inclus: true, ptacInconnu: false });
    expect(eligibiliteTicpe({ type: "SPL", ptac_kg: "44000" })).toEqual({ inclus: true, ptacInconnu: false });
  });
  it("PTAC inconnu : inclus mais signalé", () => {
    expect(eligibiliteTicpe({ type: "PL" })).toEqual({ inclus: true, ptacInconnu: true });
  });
  it("exclusions", () => {
    expect(eligibiliteTicpe({ type: "VL" }).inclus).toBe(false);
    expect(eligibiliteTicpe({ type: "PL", ptac_kg: 5000 }).inclus).toBe(false);
    expect(eligibiliteTicpe({ type: "PL", ptac_kg: 19000, fuel_type: "Électrique" }).inclus).toBe(false);
    expect(eligibiliteTicpe({ type: "PL", ptac_kg: 19000, fuel_type: "GNV" }).inclus).toBe(false);
    expect(eligibiliteTicpe({ type: "PL", spec_sources: { type: { origin: "ia", confirmed: false } } }).inclus).toBe(false);
  });
});

describe("bornes de période en heure de Paris", () => {
  it("minuit l'hiver (UTC+1) et l'été (UTC+2)", () => {
    expect(minuitParis("2026-01-01")).toBe("2025-12-31T23:00:00.000Z");
    expect(minuitParis("2026-07-01")).toBe("2026-06-30T22:00:00.000Z");
  });
  it("fin exclue = minuit du lendemain", () => {
    expect(bornesPeriode("2026-01-01", "2026-06-30")).toEqual({ depuis: "2025-12-31T23:00:00.000Z", avant: "2026-06-30T22:00:00.000Z" });
  });
  it("changement d'heure", () => {
    expect(minuitParis("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
    expect(minuitParis("2026-03-30")).toBe("2026-03-29T22:00:00.000Z");
  });
});
