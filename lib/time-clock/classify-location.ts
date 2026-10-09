import { haversineDistanceKm, type Coordinates } from "@/lib/business/fuel-profitability";

const MATCH_RADIUS_KM = 0.3; // 300 m — GPS on a phone easily drifts that much

export type LocationLabel = "depot" | "domicile" | "autre" | "inconnu";

/**
 * Classifies a captured badge location against the two reference
 * points that already exist for this driver (organizations.depot_lat/
 * lng, users.address_lat/lng) — never a new geocoding call, just a
 * straight-line distance against what's already on file.
 */
export function classifyLocation(point: Coordinates | null, depot: Coordinates | null, home: Coordinates | null): LocationLabel {
  if (!point) return "inconnu";
  if (depot && haversineDistanceKm(point, depot) <= MATCH_RADIUS_KM) return "depot";
  if (home && haversineDistanceKm(point, home) <= MATCH_RADIUS_KM) return "domicile";
  return "autre";
}

export const LOCATION_LABEL_DISPLAY: Record<LocationLabel, string> = {
  depot: "🏭 Dépôt",
  domicile: "🏠 Domicile",
  autre: "📍 Autre lieu",
  inconnu: "— position inconnue",
};
