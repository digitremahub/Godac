import { describe, expect, it } from "vitest";
import { parisDay, parisDayRange, parisLocalToIso, parisMidnightIso, parisMonthStartDay, parisMonthStartIso } from "@/lib/utils/paris-time";

describe("parisLocalToIso", () => {
  it("hiver : UTC+1", () => {
    expect(parisLocalToIso("2026-01-15", "08:30")).toBe("2026-01-15T07:30:00.000Z");
  });

  it("été : UTC+2", () => {
    expect(parisLocalToIso("2026-07-14", "14:05:09")).toBe("2026-07-14T12:05:09.000Z");
  });

  it("sans heure : minuit de Paris", () => {
    expect(parisLocalToIso("2026-07-01")).toBe("2026-06-30T22:00:00.000Z");
    expect(parisLocalToIso("2026-01-01", null)).toBe("2025-12-31T23:00:00.000Z");
  });

  it("jour du passage à l'heure d'été (29/03/2026)", () => {
    expect(parisLocalToIso("2026-03-29", "01:30")).toBe("2026-03-29T00:30:00.000Z");
    expect(parisLocalToIso("2026-03-29", "03:30")).toBe("2026-03-29T01:30:00.000Z");
    expect(parisLocalToIso("2026-03-29", "12:00")).toBe("2026-03-29T10:00:00.000Z");
    // 02:30 n'existe pas ce jour-là : décalé à 03:30 CEST.
    expect(parisLocalToIso("2026-03-29", "02:30")).toBe("2026-03-29T01:30:00.000Z");
  });

  it("jour du passage à l'heure d'hiver (25/10/2026)", () => {
    expect(parisLocalToIso("2026-10-25", "01:30")).toBe("2026-10-24T23:30:00.000Z");
    expect(parisLocalToIso("2026-10-25", "12:00")).toBe("2026-10-25T11:00:00.000Z");
    // 02:30 existe deux fois : seconde occurrence (CET).
    expect(parisLocalToIso("2026-10-25", "02:30")).toBe("2026-10-25T01:30:00.000Z");
  });

  it("formats invalides → null", () => {
    expect(parisLocalToIso("15/01/2026", "08:30")).toBeNull();
    expect(parisLocalToIso("2026-02-30")).toBeNull();
    expect(parisLocalToIso("2026-01-15", "25:00")).toBeNull();
    expect(parisLocalToIso("2026-01-15", "8h30")).toBeNull();
  });
});

describe("bornes de période", () => {
  it("parisMidnightIso et parisDayRange", () => {
    expect(parisMidnightIso("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
    expect(parisDayRange("2026-03-01", "2026-03-31")).toEqual({
      since: "2026-02-28T23:00:00.000Z",
      before: "2026-03-31T22:00:00.000Z",
    });
  });

  it("parisDay suit le calendrier de Paris", () => {
    expect(parisDay(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(parisDay(new Date("2026-12-31T22:59:00Z"))).toBe("2026-12-31");
  });

  it("début de mois", () => {
    const instant = new Date("2026-06-30T22:30:00Z"); // 1er juillet 00:30 à Paris
    expect(parisMonthStartDay(instant)).toBe("2026-07-01");
    expect(parisMonthStartIso(instant)).toBe("2026-06-30T22:00:00.000Z");
    expect(parisMonthStartDay(instant, -6)).toBe("2026-01-01");
    expect(parisMonthStartIso(new Date("2026-01-10T12:00:00Z"), -1)).toBe("2025-11-30T23:00:00.000Z");
  });
});
