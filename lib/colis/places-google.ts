// Google Places (New) pour la saisie d'adresse : fonctions pures (corps de
// requête, lecture des réponses, validation des paramètres). Les appels
// réseau sont dans app/api/colis/adresses/recherche et .../detail.
// Autocomplete renvoie des textes + place_id (rapide, sans coordonnées) ; les
// coordonnées ne sont demandées (Place Details, champs minimaux) qu'au choix
// de la suggestion, dans la même session (jeton) pour limiter le coût.

import type { SuggestionAdresse } from "@/lib/colis/recherche-adresses";

export const URL_AUTOCOMPLETE = "https://places.googleapis.com/v1/places:autocomplete";
export const URL_DETAIL = "https://places.googleapis.com/v1/places/";
export const MASQUE_AUTOCOMPLETE = "suggestions.placePrediction.placeId,suggestions.placePrediction.types,suggestions.placePrediction.structuredFormat";
export const MASQUE_DETAIL = "location,formattedAddress,displayName";

/** Clé Google : GOOGLE_PLACES_API_KEY, à défaut GOOGLE_MAPS_API_KEY. */
export function cleGoogle(env: Record<string, string | undefined>): string | null {
  return env.GOOGLE_PLACES_API_KEY?.trim() || env.GOOGLE_MAPS_API_KEY?.trim() || null;
}

/** Jeton de session : uuid ou chaîne sûre (16 à 64 caractères). */
export function sessionValide(s: string | null | undefined): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(s);
}

export function placeIdValide(s: string | null | undefined): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{10,300}$/.test(s);
}

export function corpsAutocomplete(q: string, pays: string, biais: { lat: number; lng: number } | null, session: string | null): Record<string, unknown> {
  return {
    input: q,
    languageCode: "fr",
    includedRegionCodes: [pays.toLowerCase()],
    ...(session ? { sessionToken: session } : {}),
    ...(biais ? { locationBias: { circle: { center: { latitude: biais.lat, longitude: biais.lng }, radius: 30000 } } } : {}),
  };
}

interface ReponseAutocomplete {
  suggestions?: { placePrediction?: { placeId?: string; types?: string[]; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[];
}

/** Réponse Autocomplete → suggestions (sans coordonnées, avec placeId). */
export function lireAutocomplete(data: unknown, limite = 6): SuggestionAdresse[] {
  const liste = (data as ReponseAutocomplete | null)?.suggestions ?? [];
  const sortie: SuggestionAdresse[] = [];
  for (const s of liste) {
    const p = s.placePrediction;
    const principal = p?.structuredFormat?.mainText?.text;
    if (!p || !principal) continue;
    const secondaire = p.structuredFormat?.secondaryText?.text ?? "";
    const etablissement = (p.types ?? []).includes("establishment") && Boolean(secondaire);
    sortie.push(
      etablissement
        ? { type: "etablissement", nom: principal, adresse: secondaire, lat: null, lng: null, source: "google", placeId: p.placeId }
        : { type: "adresse", nom: null, adresse: secondaire ? `${principal}, ${secondaire}` : principal, lat: null, lng: null, source: "google", placeId: p.placeId },
    );
    if (sortie.length >= limite) break;
  }
  return sortie;
}

export interface DetailLieu {
  lat: number;
  lng: number;
  adresse: string | null;
  nom: string | null;
}

/** Réponse Place Details → coordonnées (null si absentes). */
export function lireDetail(data: unknown): DetailLieu | null {
  const d = data as { location?: { latitude?: number; longitude?: number }; formattedAddress?: string; displayName?: { text?: string } } | null;
  const lat = d?.location?.latitude;
  const lng = d?.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, adresse: d?.formattedAddress ?? null, nom: d?.displayName?.text ?? null };
}
