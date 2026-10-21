// Fil d'Ariane GPS d'une tournée colis (trajet réellement emprunté) :
// logique pure, testée dans lib/colis/__tests__/trace-gps.test.ts.
//  - côté chauffeur : filtrage et échantillonnage des positions, file
//    d'attente locale (réseau coupé) plafonnée, décision d'envoi par lots ;
//  - côté historique : km réels, durée de conduite, arrêts prolongés hors
//    arrêts de livraison.
// Collecte uniquement pendant la tournée en cours (RGPD) : voir
// app/api/colis/trace et la migration 20261025000001_trace_gps_tournees.

import { haversineKm, type Point } from "@/lib/colis/itineraire";

/** Un point du tracé : t en millisecondes (horodatage du GPS). */
export interface PointTrace {
  t: number;
  lat: number;
  lng: number;
  /** Précision horizontale (m). */
  acc?: number | null;
  /** Vitesse (m/s). */
  v?: number | null;
  /** Cap (degrés). */
  cap?: number | null;
}

/** Précision maximale acceptée (m) : au-delà, le point est ignoré. */
export const PRECISION_MAX_M = 50;
/** Distance minimale (m) au point précédent gardé. */
export const DISTANCE_MIN_M = 20;
/** Délai minimal (ms) entre deux points gardés en roulant (évite un point par seconde sur route). */
export const INTERVALLE_MIN_MS = 3_000;
/** À l'arrêt : un point toutes les 30 s (durées d'immobilisation). */
export const INTERVALLE_ARRET_MS = 30_000;
/** Envoi par lots : dès 10 points en attente… */
export const LOT_POINTS = 10;
/** … ou toutes les 20 s s'il y a au moins un point. */
export const LOT_DELAI_MS = 20_000;
/** Plafond de points par requête (côté client et côté serveur). */
export const MAX_POINTS_REQUETE = 200;
/** Plafond de la file locale (≈ 1 h 30 de conduite sans réseau) : au-delà, les plus anciens sont perdus. */
export const MAX_FILE = 2_000;

const metres = (a: Point, b: Point) => haversineKm(a, b) * 1000;

/** Le point est-il exploitable (coordonnées valides, précision ≤ 50 m) ? */
export function pointValide(p: PointTrace): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !Number.isFinite(p.t)) return false;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return false;
  if (p.lat === 0 && p.lng === 0) return false;
  return p.acc == null || (Number.isFinite(p.acc) && p.acc <= PRECISION_MAX_M);
}

/**
 * Garder ce point dans le tracé ? Oui s'il est valide et : premier point,
 * ou à plus de 20 m du précédent gardé (et 3 s au moins après lui), ou
 * 30 s après lui (immobilisation).
 */
export function garderPoint(precedent: PointTrace | null, p: PointTrace): boolean {
  if (!pointValide(p)) return false;
  if (!precedent) return true;
  const dt = p.t - precedent.t;
  if (dt <= 0) return false;
  if (dt >= INTERVALLE_ARRET_MS) return true;
  return dt >= INTERVALLE_MIN_MS && metres(precedent, p) >= DISTANCE_MIN_M;
}

/** Ajout à la file locale, plafonnée : les plus anciens points sautent. */
export function ajouterAFile(file: readonly PointTrace[], p: PointTrace, plafond = MAX_FILE): PointTrace[] {
  const suite = [...file, p];
  return suite.length > plafond ? suite.slice(suite.length - plafond) : suite;
}

/** Faut-il envoyer un lot maintenant ? */
export function doitEnvoyer(enAttente: number, dernierEnvoi: number, maintenant: number): boolean {
  if (enAttente <= 0) return false;
  return enAttente >= LOT_POINTS || maintenant - dernierEnvoi >= LOT_DELAI_MS;
}

/** File relue depuis le stockage local : seulement des points valides, dans l'ordre, plafonnée. */
export function lireFile(brut: string | null | undefined, plafond = MAX_FILE): PointTrace[] {
  if (!brut) return [];
  try {
    const v = JSON.parse(brut) as unknown;
    if (!Array.isArray(v)) return [];
    const pts = v.filter((p): p is PointTrace => !!p && typeof p === "object" && pointValide(p as PointTrace)).sort((a, b) => a.t - b.t);
    return pts.slice(Math.max(0, pts.length - plafond));
  } catch {
    return [];
  }
}

/** Au-delà de cette vitesse entre deux points (≈ 200 km/h), le saut est un défaut du GPS : non compté. */
export const VITESSE_ABERRANTE_MS = 200 / 3.6;
/** En dessous (≈ 5 km/h), le véhicule est considéré à l'arrêt pour la durée de conduite. */
export const VITESSE_ROULE_MS = 1.5;
/** Un intervalle sans point plus long que ça n'est pas compté dans la durée de conduite (application fermée). */
export const TROU_MAX_MS = 5 * 60_000;

/** Kilomètres réellement parcourus : somme des segments, sauts aberrants exclus. */
export function kmParcourus(points: readonly PointTrace[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = metres(a, b);
    const dt = (b.t - a.t) / 1000;
    if (dt > 0 && d / dt > VITESSE_ABERRANTE_MS) continue;
    m += d;
  }
  return m / 1000;
}

/** Durée de conduite (min) : intervalles où le véhicule roule (> 5 km/h), trous de plus de 5 min exclus. */
export function dureeConduiteMin(points: readonly PointTrace[]): number {
  let ms = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dt = b.t - a.t;
    if (dt <= 0 || dt > TROU_MAX_MS) continue;
    const v = metres(a, b) / (dt / 1000);
    if (v >= VITESSE_ROULE_MS && v <= VITESSE_ABERRANTE_MS) ms += dt;
  }
  return ms / 60_000;
}

export interface ArretProlonge {
  lat: number;
  lng: number;
  debut: number;
  fin: number;
  dureeMin: number;
}

/** Immobilisation signalée au-delà de 5 min. */
export const ARRET_PROLONGE_MS = 5 * 60_000;
/** Rayon (m) dans lequel le véhicule est considéré immobile (bruit GPS compris). */
export const RAYON_IMMOBILE_M = 40;
/** Une immobilisation à moins de 80 m d'un arrêt de livraison est la livraison elle-même : non signalée. */
export const RAYON_ARRET_LIVRAISON_M = 80;

/**
 * Arrêts prolongés : le véhicule reste dans un rayon de 40 m pendant plus
 * de 5 min, hors des arrêts de livraison (à moins de 80 m de l'un d'eux).
 */
export function arretsProlonges(points: readonly PointTrace[], arretsLivraison: readonly Point[] = [], options: { dureeMs?: number; rayonM?: number; rayonLivraisonM?: number } = {}): ArretProlonge[] {
  const dureeMs = options.dureeMs ?? ARRET_PROLONGE_MS;
  const rayon = options.rayonM ?? RAYON_IMMOBILE_M;
  const rayonLivraison = options.rayonLivraisonM ?? RAYON_ARRET_LIVRAISON_M;
  const res: ArretProlonge[] = [];
  let i = 0;
  while (i < points.length) {
    const ancre = points[i]!;
    let j = i + 1;
    while (j < points.length && metres(ancre, points[j]!) <= rayon) j++;
    const dernier = points[j - 1]!;
    if (dernier.t - ancre.t >= dureeMs) {
      const groupe = points.slice(i, j);
      const lat = groupe.reduce((s, p) => s + p.lat, 0) / groupe.length;
      const lng = groupe.reduce((s, p) => s + p.lng, 0) / groupe.length;
      const centre = { lat, lng };
      if (!arretsLivraison.some((a) => metres(a, centre) <= rayonLivraison)) {
        res.push({ lat, lng, debut: ancre.t, fin: dernier.t, dureeMin: Math.round((dernier.t - ancre.t) / 60_000) });
      }
      i = j;
    } else i++;
  }
  return res;
}

/** Points d'une réponse compacte de l'API ([lng, lat, t] ; t en ms). */
export function depuisCompact(lignes: readonly (readonly [number, number, number])[]): PointTrace[] {
  return lignes.filter((l) => Array.isArray(l) && l.length >= 3).map(([lng, lat, t]) => ({ lng, lat, t }));
}
