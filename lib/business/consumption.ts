/**
 * Fuel consumption (L/100km) per vehicle over a period. Diesel liters
 * come from fuel_entries; km traveled comes from whichever odometer
 * readings exist for the vehicle in that window (tours, maintenance
 * requests) — there is no odometer field on fuel_entries itself (see
 * 20260101000003_fuel_tables.sql's comment: totalizer_before/after is
 * the TANK's index, not the vehicle's). Pure and side-effect-free —
 * the readings/liters lookup lives in lib/vehicles/consumption.ts,
 * same split as lib/business/odometer.ts vs. odometer-reference.ts.
 */

export interface OdometerPoint {
  at: string;
  km: number;
}

/**
 * Distance covered within a window, from whatever odometer points
 * fall inside it — the earliest and latest by date, not by value, so
 * a single out-of-order bad reading can't silently invert the delta.
 * Fewer than two points, or a non-positive delta, means there isn't
 * enough data to trust a number — returns null rather than guessing.
 */
export function computeKmTraveled(readings: OdometerPoint[]): number | null {
  if (readings.length < 2) return null;
  const sorted = [...readings].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const delta = last.km - first.km;
  return delta > 0 ? delta : null;
}

/** Liters per 100km. null when there's no reliable distance to divide by. */
export function computeConsumptionLPer100Km(litersConsumed: number, kmTraveled: number | null): number | null {
  if (kmTraveled === null || kmTraveled <= 0 || litersConsumed <= 0) return null;
  return Math.round((litersConsumed / kmTraveled) * 100 * 10) / 10;
}

export interface ConsumptionAnomalyCheck {
  anomaly: boolean;
  deviationPercent: number | null;
}

/**
 * Flags a vehicle whose recent consumption has drifted well above its
 * own historical average — not an absolute threshold, since a van and
 * a loaded SPL tractor have nothing in common on L/100km. Needs at
 * least `minFillUps` fill-ups in the baseline period, otherwise the
 * "average" is too thin to mean anything.
 */
export function detectConsumptionAnomaly(
  currentLPer100Km: number,
  baselineLPer100Km: number | null,
  fillUpCount: number,
  options: { thresholdPercent?: number; minFillUps?: number } = {},
): ConsumptionAnomalyCheck {
  const thresholdPercent = options.thresholdPercent ?? 20;
  const minFillUps = options.minFillUps ?? 3;
  if (baselineLPer100Km === null || baselineLPer100Km <= 0 || fillUpCount < minFillUps) {
    return { anomaly: false, deviationPercent: null };
  }
  const deviationPercent = Math.round(((currentLPer100Km - baselineLPer100Km) / baselineLPer100Km) * 1000) / 10;
  return { anomaly: deviationPercent > thresholdPercent, deviationPercent };
}
