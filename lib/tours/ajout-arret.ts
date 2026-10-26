/**
 * Ajout d'une ramasse ou d'un point relais à un village : classement des
 * suggestions d'établissements par proximité du village et conversion d'une
 * suggestion en arrêt planifié. Logique pure ; les sources (annuaire, Google
 * Places, BAN, OpenStreetMap) sont celles de la tournée colis.
 */
import { haversineKm } from "@/lib/tours/carte-villages";
import type { SuggestionAdresse } from "@/lib/colis/recherche-adresses";

export interface Biais {
  lat: number;
  lng: number;
}

export interface ArretDepuisSuggestion {
  type: "ramasse" | "point_relais";
  name?: string;
  address: string;
  postal_code?: string;
  city?: string;
  lat?: number;
  lng?: number;
}

const coordonnees = (s: SuggestionAdresse) => (s.lat !== null && s.lng !== null ? ([s.lng, s.lat] as [number, number]) : null);

/**
 * Les établissements passent avant les adresses seules ; entre suggestions
 * dont on connaît la position, la plus proche du village d'abord. Une
 * suggestion sans coordonnées (Google, résolues au choix) garde sa place :
 * la source la classe déjà autour du village. À défaut de biais, l'ordre
 * reçu est conservé.
 */
export function classerParProximite(suggestions: readonly SuggestionAdresse[], biais: Biais | null | undefined): SuggestionAdresse[] {
  const liste = [...suggestions];
  if (!biais) return liste;
  const centre: [number, number] = [biais.lng, biais.lat];
  const avecPosition = liste
    .map((s, i) => ({ s, i, c: coordonnees(s) }))
    .filter((x): x is { s: SuggestionAdresse; i: number; c: [number, number] } => x.c !== null);
  const triees = [...avecPosition].sort((a, b) => haversineKm(centre, a.c) - haversineKm(centre, b.c));
  avecPosition.forEach((place, k) => {
    liste[place.i] = triees[k]!.s;
  });
  // Établissements d'abord (tri stable).
  return liste.map((s, i) => ({ s, i })).sort((a, b) => Number(b.s.type === "etablissement") - Number(a.s.type === "etablissement") || a.i - b.i).map((x) => x.s);
}

/** « 12 rue X, 66300 Thuir » → code postal et commune. */
export function decouperAdresse(adresse: string): { codePostal: string | null; commune: string | null } {
  const m = adresse.match(/(?<!\d)(\d{5})(?!\d)\s*,?\s*([^,\d][^,]*)?/);
  if (!m) return { codePostal: null, commune: null };
  return { codePostal: m[1]!, commune: m[2]?.trim() || null };
}

/** Suggestion choisie → ramasse ou point relais prêt à être ajouté (rien à retaper). */
export function arretDepuisSuggestion(s: SuggestionAdresse, type: "ramasse" | "point_relais"): ArretDepuisSuggestion {
  const { codePostal, commune } = decouperAdresse(s.adresse);
  return {
    type,
    ...(s.nom ? { name: s.nom } : {}),
    address: s.adresse,
    ...(codePostal ? { postal_code: codePostal } : {}),
    ...(commune ? { city: commune } : {}),
    ...(s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : {}),
  };
}

/** Saisie à la main : nom ET adresse obligatoires. */
export function arretManuelValide(nom: string, adresse: string): boolean {
  return nom.trim().length > 0 && adresse.trim().length > 0;
}
