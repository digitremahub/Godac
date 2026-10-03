import { describe, expect, it } from "vitest";
import { detectTotalizerGap } from "../totalizer-gap";

describe("detectTotalizerGap", () => {
  it("returns no gap for the first-ever entry on a tank", () => {
    const result = detectTotalizerGap(null, { totalizer_before: 100 });
    expect(result).toEqual({ gap: null, flagged: false });
  });

  it("returns no gap when totalizer_before was not captured", () => {
    const result = detectTotalizerGap(
      { totalizer_after: 1000 },
      { totalizer_before: null },
    );
    expect(result).toEqual({ gap: null, flagged: false });
  });

  it("detects perfect continuity between two different drivers on the same tank", () => {
    // Driver A fills up, tank ends at 1000. Driver B fills up next,
    // starting exactly at 1000 -> continuous, no gap.
    const result = detectTotalizerGap(
      { totalizer_after: 1000 },
      { totalizer_before: 1000 },
    );
    expect(result.flagged).toBe(false);
    expect(result.gap).toBe(0);
  });

  it("flags an unrecorded fill-up between two entries on the same tank", () => {
    // Tank left at 1000, but the next recorded entry starts at 1050 —
    // 50 L were dispensed without ever being logged in GODAC.
    const result = detectTotalizerGap(
      { totalizer_after: 1000 },
      { totalizer_before: 1050 },
    );
    expect(result.flagged).toBe(true);
    expect(result.gap).toBe(50);
  });

  it("stays within tolerance for rounding noise", () => {
    const result = detectTotalizerGap(
      { totalizer_after: 1000 },
      { totalizer_before: 1000.2 },
      0.5,
    );
    expect(result.flagged).toBe(false);
  });

  it("flags a negative gap (totalizer went backwards) too", () => {
    const result = detectTotalizerGap(
      { totalizer_after: 1000 },
      { totalizer_before: 980 },
    );
    expect(result.flagged).toBe(true);
    expect(result.gap).toBe(-20);
  });
});
