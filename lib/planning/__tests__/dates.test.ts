import { afterEach, describe, expect, it } from "vitest";
import { mondayOf, addDays, toISODate, todayISO, firstOfMonth, addMonths, monthCalendarDays } from "../dates";

describe("mondayOf", () => {
  it("returns the same date when already a Monday", () => {
    expect(toISODate(mondayOf(new Date("2026-03-02T15:00:00")))).toBe("2026-03-02");
  });

  it("rolls back a Wednesday to its Monday", () => {
    expect(toISODate(mondayOf(new Date("2026-03-04T08:00:00")))).toBe("2026-03-02");
  });

  it("rolls back a Sunday to the Monday before it (not the next one)", () => {
    expect(toISODate(mondayOf(new Date("2026-03-08T08:00:00")))).toBe("2026-03-02");
  });
});

describe("timezone independence", () => {
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it("addDays/mondayOf/todayISO agree with the UTC calendar day regardless of the process timezone", () => {
    // Regression test: this used to mix local-time Date construction
    // with toISOString() (always UTC), so every result came out one
    // day early for a process running ahead of UTC — exactly what a
    // French user's own browser is (UTC+1/+2), which is how the
    // planning grid's whole row of day columns ended up mislabeled by
    // one day for real users despite passing in CI (UTC).
    process.env.TZ = "Europe/Paris";
    expect(addDays("2026-09-28", 0)).toBe("2026-09-28");
    expect(toISODate(mondayOf(new Date("2026-10-02T22:48:00Z")))).toBe("2026-09-28");
    expect(todayISO()).toBe(toISODate(new Date()));
  });
});

describe("addDays", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("subtracts days across a year boundary", () => {
    expect(addDays("2026-01-02", -5)).toBe("2025-12-28");
  });
});

describe("firstOfMonth / addMonths", () => {
  it("resolves the first day of a month", () => {
    expect(firstOfMonth("2026-03")).toBe("2026-03-01");
  });

  it("steps forward and backward across a year boundary", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("monthCalendarDays", () => {
  it("starts on a Monday and ends on a Sunday", () => {
    const days = monthCalendarDays("2026-03");
    expect(new Date(`${days[0]}T00:00:00`).getDay()).toBe(1);
    expect(new Date(`${days[days.length - 1]}T00:00:00`).getDay()).toBe(0);
  });

  it("covers every day of the month itself", () => {
    const days = new Set(monthCalendarDays("2026-02"));
    for (let d = 1; d <= 28; d++) {
      expect(days.has(`2026-02-${String(d).padStart(2, "0")}`)).toBe(true);
    }
  });

  it("is a whole number of weeks", () => {
    const days = monthCalendarDays("2026-05");
    expect(days.length % 7).toBe(0);
  });
});
