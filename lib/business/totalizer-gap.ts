/**
 * Totalizer-continuity check (Module 2).
 *
 * All drivers refuelling from the same tank share one totalizer
 * index. Between two consecutive TRUSTED fill-ups on that tank
 * (status 'manual' or 'validated' — never an unvalidated OCR row),
 * the index must be continuous: entry N's `totalizer_after` must
 * equal entry N+1's `totalizer_before`. A discrepancy means a
 * fill-up happened that was never recorded in GODAC at all.
 *
 * This is deliberately NOT a per-vehicle odometer/mileage check —
 * it says nothing about how far a truck drove, only whether the
 * shared tank's dispensed-liters counter is accounted for end to end.
 *
 * Mirrors the `compute_fuel_entry_derived` Postgres trigger; kept
 * here for previewing the gap client-side before submission and for
 * unit testing the rule in isolation.
 */
export interface TotalizerGapResult {
  gap: number | null;
  flagged: boolean;
}

const DEFAULT_TOLERANCE_LITERS = 0.5;

export function detectTotalizerGap(
  previousTrustedEntry: { totalizer_after: number } | null,
  newEntry: { totalizer_before: number | null },
  toleranceLiters = DEFAULT_TOLERANCE_LITERS,
): TotalizerGapResult {
  if (!previousTrustedEntry || newEntry.totalizer_before === null) {
    return { gap: null, flagged: false };
  }

  const gap = roundTo(
    newEntry.totalizer_before - previousTrustedEntry.totalizer_after,
    2,
  );

  return {
    gap,
    flagged: Math.abs(gap) > toleranceLiters,
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
