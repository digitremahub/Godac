import { describe, expect, it } from "vitest";
import { findOverlappingLeaves } from "../leave-overlap";

describe("findOverlappingLeaves", () => {
  const existing = [
    { driverId: "driver-a", startDate: "2026-07-10", endDate: "2026-07-20" },
  ];

  it("flags an overlapping request from a different driver", () => {
    const overlaps = findOverlappingLeaves(
      { driverId: "driver-b", startDate: "2026-07-15", endDate: "2026-07-25" },
      existing,
    );
    expect(overlaps).toHaveLength(1);
  });

  it("ignores the same driver's own other leave", () => {
    const overlaps = findOverlappingLeaves(
      { driverId: "driver-a", startDate: "2026-07-15", endDate: "2026-07-25" },
      existing,
    );
    expect(overlaps).toHaveLength(0);
  });

  it("does not flag adjacent, non-overlapping periods", () => {
    const overlaps = findOverlappingLeaves(
      { driverId: "driver-b", startDate: "2026-07-21", endDate: "2026-07-25" },
      existing,
    );
    expect(overlaps).toHaveLength(0);
  });
});
