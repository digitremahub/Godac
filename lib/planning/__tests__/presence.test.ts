import { describe, expect, it } from "vitest";
import { presenceByDay } from "../presence";

describe("presenceByDay", () => {
  it("marks morning on the start day and evening on the return day", () => {
    const { days, mornings, evenings } = presenceByDay(
      [{ start_at: "2026-10-05T04:30:00Z", end_at: "2026-10-05T16:10:00Z", status: "done" }],
      "2026-10",
    );
    expect(days.get("2026-10-05")).toEqual({ morning: true, evening: true });
    expect(mornings).toBe(1);
    expect(evenings).toBe(1);
  });

  it("counts an open tour as a morning only", () => {
    const { days } = presenceByDay([{ start_at: "2026-10-12T05:00:00Z", end_at: null, status: "in_progress" }], "2026-10");
    expect(days.get("2026-10-12")).toEqual({ morning: true, evening: false });
  });

  it("ignores tours that were only planned", () => {
    const { days, mornings } = presenceByDay([{ start_at: "2026-10-14T05:00:00Z", end_at: null, status: "planned" }], "2026-10");
    expect(days.size).toBe(0);
    expect(mornings).toBe(0);
  });

  it("uses the Paris calendar day, not the UTC one", () => {
    // 23:30 UTC on the 6th is already 01:30 on the 7th in Paris (CEST).
    const { days } = presenceByDay([{ start_at: "2026-10-06T23:30:00Z", end_at: null, status: "in_progress" }], "2026-10");
    expect(days.has("2026-10-07")).toBe(true);
    expect(days.has("2026-10-06")).toBe(false);
  });

  it("drops days that fall outside the requested month", () => {
    const { days } = presenceByDay(
      [{ start_at: "2026-09-30T05:00:00Z", end_at: "2026-10-01T03:00:00Z", status: "done" }],
      "2026-10",
    );
    expect(days.get("2026-09-30")).toBeUndefined();
    expect(days.get("2026-10-01")).toEqual({ morning: false, evening: true });
  });
});
