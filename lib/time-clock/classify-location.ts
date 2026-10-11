import { haversineDistanceKm, type Coordinates } from "@/lib/business/fuel-profitability";

const MATCH_RADIUS_KM = 0.3; // 300 m — GPS on a phone easily drifts that much

export type LocationLabel = "depot" | "domicile" | "autre" | "inconnu";

/**
 * Classifies a captured badge location against the reference points
 * that already exist for this driver — their service(s)' depot(s)
 * when set (services.depot_lat/lng), falling back to the
 * organisation-wide one (organizations.depot_lat/lng) otherwise, plus
 * their home address (users.address_lat/lng) — never a new geocoding
 * call, just a straight-line distance against what's already on file.
 *
 * `depots` accepts several candidates rather than one because a
 * driver can be qualified on more than one service (user_services),
 * each potentially with its own depot — matching any one of them
 * counts as "at the depot", not just the first/primary service.
 */
export function classifyLocation(point: Coordinates | null, depots: Coordinates[], home: Coordinates | null): LocationLabel {
  if (!point) return "inconnu";
  if (depots.some((depot) => haversineDistanceKm(point, depot) <= MATCH_RADIUS_KM)) return "depot";
  if (home && haversineDistanceKm(point, home) <= MATCH_RADIUS_KM) return "domicile";
  return "autre";
}

export const LOCATION_LABEL_DISPLAY: Record<LocationLabel, string> = {
  depot: "🏭 Dépôt",
  domicile: "🏠 Domicile",
  autre: "📍 Autre lieu",
  inconnu: "— position inconnue",
};
