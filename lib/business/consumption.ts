/**
 * Fuel consumption (L/100km) per vehicle over a period. Km traveled
 * comes from the odometer readings in that window (tour start/end,
 * interventions, and the vehicle_km typed at each trusted fill-up —
 * totalizer_before/after is the TANK's index, never the vehicle's);
 * gazole liters from trusted fill-ups (see computeWindowConsumption
 * for which ones count). Pure and side-effect-free —
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

export interface FillUpPoint {
  at: string;
  liters: number;
}

export interface WindowConsumption {
  km: number;
  liters: number;
  lPer100Km: number | null;
}

/**
 * Consumption between the first and last odometer reading of a
 * window. Only the fill-ups strictly after the first reading and up to
 * (inclusive) the last one count: the fuel bought at or before the
 * first reading was burnt before it, so summing every litre of the
 * window against a shorter distance overstated L/100km. Pass only
 * trusted gazole fill-ups (status manual/validated, product gazole —
 * AdBlue isn't fuel). null with fewer than two readings or km ≤ 0.
 */
export function computeWindowConsumption(readings: OdometerPoint[], fillUps: FillUpPoint[]): WindowConsumption | null {
  if (readings.length < 2) return null;
  const sorted = [...readings].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const km = last.km - first.km;
  if (!(km > 0)) return null;
  const from = Date.parse(first.at);
  const to = Date.parse(last.at);
  const liters = fillUps
    .filter((f) => {
      const t = Date.parse(f.at);
      return t > from && t <= to;
    })
    .reduce((sum, f) => sum + Number(f.liters ?? 0), 0);
  const rounded = Math.round(liters * 100) / 100;
  return { km, liters: rounded, lPer100Km: computeConsumptionLPer100Km(rounded, km) };
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
