/**
 * Odometer coherence checks for tour start/end (Module 5 — tournées
 * fiables). Pure and side-effect-free so they can be previewed
 * client-side and unit tested in isolation; the actual "what's the
 * vehicle's last known reading" lookup (tours, interventions,
 * vehicles.initial_km) lives in the API routes that call these, same
 * split as lib/business/totalizer-gap.ts vs. its trigger.
 */

export interface OdometerRegressionCheck {
  ok: boolean;
  message: string | null;
}

/**
 * Rejects a reading lower than a known reference point — whether
 * that's the vehicle's last known odometer reading from any source,
 * or this same tour's own departure km. `referenceKm: null` means no
 * prior reading exists yet (a brand new vehicle), which always passes.
 */
export function checkOdometerNotRegressing(
  newKm: number,
  referenceKm: number | null,
  referenceLabel: string,
): OdometerRegressionCheck {
  if (referenceKm === null) return { ok: true, message: null };
  if (newKm < referenceKm) {
    return {
      ok: false,
      message: `Le kilométrage saisi (${newKm} km) est inférieur à ${referenceLabel} (${referenceKm} km).`,
    };
  }
  return { ok: true, message: null };
}

export interface TourDistanceCheck {
  gapKm: number;
  isLargeGap: boolean;
}

const LARGE_TOUR_GAP_KM = 1500;

/**
 * A tour covering more than LARGE_TOUR_GAP_KM is accepted (long-haul
 * SPL tours genuinely can) but flagged for a manager to glance at —
 * usually either a very long trip or a data-entry mistake on one end.
 */
export function checkTourDistanceGap(startKm: number, endKm: number): TourDistanceCheck {
  const gapKm = endKm - startKm;
  return { gapKm, isLargeGap: gapKm > LARGE_TOUR_GAP_KM };
}
