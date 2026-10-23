/**
 * Passage au gasoil en fin de tournée : station-service la moins détournée
 * sur le chemin du retour (dépôt, siège) et consommation estimée du retour.
 */

type Pt = { lat: number; lng: number };

/** Distance à vol d'oiseau (km). */
export function distanceKm(a: Pt, b: Pt): number {
  const rad = (n: number) => (n * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Coefficient route / vol d'oiseau pour estimer les kilomètres roulés. */
export const COEF_ROUTE = 1.3;

export interface StationOSM {
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

export interface StationChoisie {
  nom: string;
  lat: number;
  lng: number;
  /** Km supplémentaires (estimés par la route) par rapport au retour direct. */
  detourKm: number;
  distanceKm: number;
}

/** Station diesel qui rallonge le moins le trajet position → destination. */
export function meilleureStation(depuis: Pt, vers: Pt, stations: StationOSM[]): StationChoisie | null {
  let meilleur: StationChoisie | null = null;
  for (const s of stations) {
    if (s.tags?.["fuel:diesel"] === "no") continue;
    const lat = s.lat ?? s.center?.lat;
    const lng = s.lon ?? s.center?.lon;
    if (lat === undefined || lng === undefined) continue;
    const p = { lat, lng };
    const aller = distanceKm(depuis, p) * COEF_ROUTE;
    const detour = aller + distanceKm(p, vers) * COEF_ROUTE - distanceKm(depuis, vers) * COEF_ROUTE;
    if (!meilleur || detour < meilleur.detourKm) {
      meilleur = {
        nom: s.tags?.name ?? s.tags?.brand ?? "Station-service",
        lat,
        lng,
        detourKm: Math.round(Math.max(0, detour) * 10) / 10,
        distanceKm: Math.round(aller * 10) / 10,
      };
    }
  }
  return meilleur;
}

/** Litres consommés sur `km` kilomètres à `lPer100` L/100 km ; null sans consommation connue. */
export function litresEstimes(km: number, lPer100: number | null): number | null {
  if (lPer100 === null || !(lPer100 > 0) || !(km >= 0)) return null;
  return Math.round(((km * lPer100) / 100) * 10) / 10;
}

export interface EtatPlein {
  /** Km parcourus depuis le dernier plein (relevés kilométriques). */
  kmDepuisPlein: number;
  /** Carburant estimé restant (L), borné à [0 ; capacité]. */
  restantL: number;
  /** Autonomie estimée (km) avec le carburant restant. */
  autonomieKm: number;
  /** Faut-il refaire le plein avant le retour ? */
  necessaire: boolean;
}

/** Réserve de sécurité : 15 % du réservoir, et 15 % de marge sur les km du retour. */
const RESERVE = 0.15;

/**
 * Niveau estimé d'après les km parcourus depuis le dernier plein, la
 * consommation du véhicule (L/100 km) et la capacité du réservoir. Le
 * dernier plein est supposé complet (hypothèse : le niveau n'est pas mesuré).
 * null si une donnée manque.
 */
export function evaluerPlein(p: { capaciteL: number | null; kmDepuisPlein: number | null; lPer100: number | null; retourKm: number }): EtatPlein | null {
  const { capaciteL, kmDepuisPlein, lPer100, retourKm } = p;
  if (!capaciteL || capaciteL <= 0 || kmDepuisPlein === null || kmDepuisPlein < 0 || !lPer100 || lPer100 <= 0) return null;
  const utilises = (kmDepuisPlein * lPer100) / 100;
  const restantL = Math.max(0, Math.min(capaciteL, capaciteL - utilises));
  const autonomieKm = Math.round((restantL / lPer100) * 100);
  const necessaire = restantL - capaciteL * RESERVE <= 0 || ((restantL - capaciteL * RESERVE) / lPer100) * 100 < retourKm * (1 + RESERVE);
  return { kmDepuisPlein: Math.round(kmDepuisPlein), restantL: Math.round(restantL * 10) / 10, autonomieKm, necessaire };
}
