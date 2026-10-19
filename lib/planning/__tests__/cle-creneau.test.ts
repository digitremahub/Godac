import { describe, expect, it } from "vitest";
import { cleCreneau } from "@/lib/planning/cle-creneau";

describe("clé de créneau de planning", () => {
  it("identique quel que soit le format ISO de start_at", () => {
    expect(cleCreneau("s", "T1", "2026-10-19T05:30:00+00:00")).toBe(cleCreneau("s", "T1", "2026-10-19T05:30:00.000Z"));
    expect(cleCreneau("s", "T1", "2026-10-19T07:30:00+02:00")).toBe(cleCreneau("s", "T1", "2026-10-19T05:30:00.000Z"));
  });
  it("différente pour une autre heure ou une autre tournée", () => {
    expect(cleCreneau("s", "T1", "2026-10-19T05:30:00Z")).not.toBe(cleCreneau("s", "T1", "2026-10-19T05:31:00Z"));
    expect(cleCreneau("s", "T1", "2026-10-19T05:30:00Z")).not.toBe(cleCreneau("s", "T2", "2026-10-19T05:30:00Z"));
  });
});
