/**
 * Tracé routier de la tournée pour la carte intégrée (étape 1 du GPS
 * livraison). Le service d'itinéraires est configurable (ROUTING_URL, API
 * compatible OSRM) ; à défaut de réponse, on trace des segments droits.
 */
export interface Point {
  lat: number;
  lng: number;
}

export interface Itineraire {
  /** Coordonnées [lng, lat] (format GeoJSON). */
  ligne: [number, number][];
  distanceKm: number;
  dureeMin: number | null;
  /** true si le tracé est approximatif (segments droits). */
  approx: boolean;
  /**
   * GO Navigation (trajet vers un seul arrêt) : manœuvres OSRM, dans
   * l'ordre. Absentes ou vides si le service ne les donne pas.
   */
  manoeuvres?: Manoeuvre[];
}

/** Manœuvre compacte tirée d'une étape OSRM (voir lib/colis/manoeuvres.ts). */
export interface Manoeuvre {
  /** Type OSRM : depart, turn, new name, continue, merge, fork, end of road, roundabout, rotary, arrive… */
  type: string;
  /** Sens OSRM : uturn, sharp right, right, slight right, straight, slight left, left, sharp left. */
  modifier?: string;
  /** Rue empruntée après la manœuvre (nom, sinon numéro de route) ; vide si inconnue. */
  rue: string;
  /** Rond-point : numéro de la sortie à prendre. */
  sortie?: number;
  /** Longueur (m) de l'étape qui suit la manœuvre. */
  distanceM: number;
  /** Point de la manœuvre [lng, lat]. */
  lieu: [number, number];
}

/** OSRM limite le nombre d'étapes par requête : au-delà, on découpe. */
export const ETAPES_MAX = 90;

export function ligneDroite(points: Point[]): Itineraire {
  let km = 0;
  for (let i = 1; i < points.length; i++) km += haversineKm(points[i - 1]!, points[i]!);
  return { ligne: points.map((p) => [p.lng, p.lat]), distanceKm: Math.round(km * 1.3 * 10) / 10, dureeMin: null, approx: true };
}

export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Découpe en tronçons de `max` points qui se recouvrent d'un point (continuité du tracé). */
export function troncons<T>(points: T[], max = ETAPES_MAX): T[][] {
  if (points.length <= max) return [points];
  const res: T[][] = [];
  for (let i = 0; i < points.length - 1; i += max - 1) res.push(points.slice(i, i + max));
  return res;
}
