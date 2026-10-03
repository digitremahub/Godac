import { describe, expect, it } from "vitest";
import { findDriverTimeConflicts } from "../planning-conflict";

describe("findDriverTimeConflicts", () => {
  it("flags another entry at the exact same instant", () => {
    const candidate = { entryId: "a", startAt: "2026-10-10T06:00:00.000Z", status: "planned" };
    const conflicts = findDriverTimeConflicts(candidate, [
      { entryId: "b", startAt: "2026-10-10T06:00:00.000Z", status: "planned" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.entryId).toBe("b");
  });

  it("does not flag the candidate against itself", () => {
    const candidate = { entryId: "a", startAt: "2026-10-10T06:00:00.000Z", status: "planned" };
    const conflicts = findDriverTimeConflicts(candidate, [candidate]);
    expect(conflicts).toHaveLength(0);
  });

  it("does not flag a different time the same day — only the exact instant", () => {
    const candidate = { entryId: "a", startAt: "2026-10-10T06:00:00.000Z", status: "planned" };
    const conflicts = findDriverTimeConflicts(candidate, [
      { entryId: "b", startAt: "2026-10-10T14:00:00.000Z", status: "planned" },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("ignores a done or cancelled-equivalent entry at the same instant", () => {
    const candidate = { entryId: "a", startAt: "2026-10-10T06:00:00.000Z", status: "planned" };
    const conflicts = findDriverTimeConflicts(candidate, [
      { entryId: "b", startAt: "2026-10-10T06:00:00.000Z", status: "done" },
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("flags an in_progress entry too, not just planned", () => {
    const candidate = { entryId: "a", startAt: "2026-10-10T06:00:00.000Z", status: "planned" };
    const conflicts = findDriverTimeConflicts(candidate, [
      { entryId: "b", startAt: "2026-10-10T06:00:00.000Z", status: "in_progress" },
    ]);
    expect(conflicts).toHaveLength(1);
  });
});
