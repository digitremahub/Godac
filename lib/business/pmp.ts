import type { PriorTankHistory } from "@/lib/types/domain";

/**
 * PMP = Prix Moyen Pondéré (weighted average price), recomputed on
 * every fill-up for a given tank. This is a pure mirror of the
 * `compute_fuel_entry_derived` Postgres trigger
 * (supabase/migrations/20260101000010_business_functions.sql) —
 * kept here so the UI can preview the resulting PMP before a
 * manager confirms an entry, and so the formula is unit-tested
 * independently of the database.
 *
 * The database trigger remains the source of truth: this function
 * must never be relied on to persist the PMP, only to preview it.
 */
export function computeWeightedAveragePrice(
  history: PriorTankHistory,
  newEntry: { liters: number; unitPrice: number },
): number {
  if (newEntry.liters <= 0) {
    throw new Error("liters must be positive to compute a PMP");
  }

  const cumulativeLiters = history.cumulativeLiters + newEntry.liters;
  const cumulativeAmount =
    history.cumulativeAmount + newEntry.liters * newEntry.unitPrice;

  return roundTo(cumulativeAmount / cumulativeLiters, 4);
}

export function isPriceAnomalous(
  unitPrice: number,
  currentPmp: number,
  thresholdRatio = 0.15,
): boolean {
  if (currentPmp <= 0) return false;
  const deviation = Math.abs(unitPrice - currentPmp) / currentPmp;
  return deviation > thresholdRatio;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
