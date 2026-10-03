/**
 * Estimates the extra distance (and fuel) a "retour à domicile" adds
 * compared to the habitual "retour au dépôt" — for rentabilité
 * carburant discussions, not as a correction of the real odometer-based
 * L/100km (lib/business/consumption.ts stays the source of truth for
 * that; a vehicle's real km traveled is real regardless of where the
 * driver sleeps). This is a separate, explicit estimate: the
 * straight-line distance between the depot and the driver's home,
 * shown alongside the real figures so a manager can see how much of a
 * driver's habitual pattern is attributable to living far from the
 * depot — never used to silently alter a reported consumption figure.
 */

export interface Coordinates {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two points — a straight-line estimate, not a real route distance. */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export type TourReturnType = "depot" | "domicile";

/**
 * null means "not enough data" (no coordinates on one side, or no
 * return type recorded yet) rather than 0 — a missing address must
 * never silently read as "no extra distance".
 */
export function estimateReturnDistanceDeltaKm(
  returnType: TourReturnType | null,
  depot: Coordinates | null,
  home: Coordinates | null,
): number | null {
  if (returnType === "depot") return 0;
  if (returnType === "domicile") {
    if (!depot || !home) return null;
    return Math.round(haversineDistanceKm(depot, home) * 10) / 10;
  }
  return null;
}

/** Converts an estimated distance into estimated extra liters, using the vehicle's own L/100km baseline. */
export function estimateExtraFuelLiters(distanceKm: number | null, lPer100Km: number | null): number | null {
  if (distanceKm === null || lPer100Km === null || lPer100Km <= 0) return null;
  return Math.round(distanceKm * (lPer100Km / 100) * 10) / 10;
}
