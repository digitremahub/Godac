import { describe, expect, it } from "vitest";
import { plannedDuplicates } from "@/lib/planning/duplicates";

const e = (id: string, status: string, start_at: string, tour_number = "T106", created_at = "2026-10-01T00:00:00Z", driver_id: string | null = "d1") => ({
  id,
  driver_id,
  tour_number,
  start_at,
  status,
  created_at,
});

describe("plannedDuplicates", () => {
  it("flags a planned entry when the driver ran a tour the same Paris day", () => {
    const r = plannedDuplicates([e("p", "planned", "2026-10-05T05:30:00Z", "T106/T105"), e("d", "done", "2026-10-05T07:18:00Z", "T106/T105")]);
    expect(r.map((x) => [x.entry.id, x.duplicateOf.id])).toEqual([["p", "d"]]);
  });

  it("never flags a tour that ran", () => {
    const r = plannedDuplicates([e("d1", "done", "2026-10-05T07:00:00Z"), e("d2", "done", "2026-10-05T12:00:00Z")]);
    expect(r).toEqual([]);
  });

  it("keeps the earliest of two identical planned entries", () => {
    const r = plannedDuplicates([
      e("a", "planned", "2026-10-13T04:30:00Z", "T106", "2026-10-01T00:00:00Z"),
      e("b", "planned", "2026-10-13T04:30:00Z", "T106", "2026-10-02T00:00:00Z"),
    ]);
    expect(r.map((x) => x.entry.id)).toEqual(["b"]);
  });

  it("ignores other days, other drivers and different planned tours", () => {
    const r = plannedDuplicates([
      e("a", "planned", "2026-10-13T04:30:00Z", "T106"),
      e("b", "done", "2026-10-14T04:30:00Z", "T106"),
      e("c", "done", "2026-10-13T04:30:00Z", "T106", undefined, "d2"),
      e("d", "planned", "2026-10-13T10:00:00Z", "T105"),
    ]);
    expect(r).toEqual([]);
  });
});
