import { haversineDistanceKm, type Coordinates } from "@/lib/business/fuel-profitability";
import { MATCH_RADIUS_KM } from "@/lib/time-clock/classify-location";

/** A fix less precise than this can't tell "at the depot" from "down the road". */
export const MAX_ACCURACY_M = 150;

/**
 * Marge au-delà du rayon du dépôt avant de conclure « parti » (sortie
 * automatique) : entre 300 m et 400 m on ne sait pas, le GPS d'un
 * téléphone dérive facilement de cette ampleur (hystérésis).
 */
export const MARGE_SORTIE_M = 100;

/**
 * Pointage assisté: is this phone position at one of the user's
 * depots? Same 300 m radius the time-clock report already uses to
 * label a badge "Dépôt" (classify-location.ts), and only for a fix
 * precise enough to mean it — a coarse network fix returns null
 * rather than a guess.
 */
export function depotMatch(
  point: Coordinates,
  accuracyM: number | null | undefined,
  depots: Coordinates[],
): { distanceM: number } | null {
  if (accuracyM === null || accuracyM === undefined || !Number.isFinite(accuracyM) || accuracyM > MAX_ACCURACY_M) return null;
  let best: number | null = null;
  for (const depot of depots) {
    const km = haversineDistanceKm(point, depot);
    if (km <= MATCH_RADIUS_KM && (best === null || km < best)) best = km;
  }
  return best === null ? null : { distanceM: Math.round(best * 1000) };
}

/** Distance (m) au dépôt le plus proche, ou null si aucun dépôt n'est connu (alors on ne conclut jamais « parti »). */
export function distanceDepotProcheM(point: Coordinates, depots: Coordinates[]): number | null {
  let best: number | null = null;
  for (const depot of depots) {
    const km = haversineDistanceKm(point, depot);
    if (best === null || km < best) best = km;
  }
  return best === null ? null : Math.round(best * 1000);
}

/** Franchement hors du dépôt : au-delà du rayon d'arrivée plus la marge de sortie. */
export function loinDuDepot(distanceM: number | null): boolean {
  return distanceM !== null && distanceM > MATCH_RADIUS_KM * 1000 + MARGE_SORTIE_M;
}
