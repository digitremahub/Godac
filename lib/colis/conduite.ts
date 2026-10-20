// GO Navigation, vue « conduite » (façon Waze / Google Maps) : logique pure
// de la caméra, testée dans lib/colis/__tests__/conduite.test.ts.
//  - cap (sens de la marche) : GPS en mouvement, sinon entre les deux
//    dernières positions, sinon direction du tracé ; lissé ;
//  - zoom selon la vitesse ;
//  - interpolation entre deux positions GPS (la voiture « avance ») ;
//  - marges de la caméra : voiture dans le tiers bas de la zone visible,
//    au-dessus de la feuille de la tournée.

import type { Point } from "@/lib/colis/itineraire";
import { distanceM, longueursCumulees, projeterSurTrace } from "@/lib/colis/navigation";

/** Inclinaison de la carte en vue conduite (degrés). */
export const PITCH_CONDUITE = 58;
/** Vitesse (m/s) au-delà de laquelle le cap du GPS est fiable. */
export const VITESSE_CAP_GPS = 1.5;
/** Déplacement minimal (m) entre deux positions pour en tirer un cap (en dessous : bruit GPS). */
export const DEPLACEMENT_CAP_M = 8;

/** Angle ramené dans [0, 360[. */
export function normaliserCap(cap: number): number {
  const c = cap % 360;
  return c < 0 ? c + 360 : c;
}

/** Écart signé le plus court de `de` vers `vers`, dans ]-180, 180]. */
export function ecartCap(de: number, vers: number): number {
  const d = normaliserCap(vers - de);
  return d > 180 ? d - 360 : d;
}

/**
 * Lissage du cap : on avance d'une fraction `facteur` vers la mesure, par
 * le plus court chemin (350° → 10° passe par le nord, pas par le sud). Les
 * petits écarts (< `seuil` degrés, tremblement du GPS) sont ignorés.
 */
export function lisserCap(precedent: number | null, mesure: number, facteur = 0.5, seuil = 3): number {
  if (precedent === null || !Number.isFinite(precedent)) return normaliserCap(mesure);
  const d = ecartCap(precedent, mesure);
  if (Math.abs(d) < seuil) return normaliserCap(precedent);
  return normaliserCap(precedent + d * Math.max(0, Math.min(1, facteur)));
}

/** Cap (degrés, nord = 0, sens horaire) pour aller de a vers b. */
export function capEntre(a: Point, b: Point): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return normaliserCap((Math.atan2(y, x) * 180) / Math.PI);
}

/** Direction du tracé au droit de la position (segment le plus proche) ; null sans tracé. */
export function capDuTrace(position: Point, ligne: readonly [number, number][]): number | null {
  const proj = projeterSurTrace(position, ligne, longueursCumulees(ligne));
  if (!proj) return null;
  const a = ligne[proj.segment - 1]!;
  const b = ligne[proj.segment]!;
  if (a[0] === b[0] && a[1] === b[1]) return null;
  return capEntre({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] });
}

/**
 * Cap mesuré, avant lissage : celui du GPS si l'on roule (> 1,5 m/s), sinon
 * celui entre les deux dernières positions (si l'on a vraiment bougé),
 * sinon la direction du tracé ; null si rien n'est connu (garder l'ancien).
 */
export function choisirCap(e: {
  capGps: number | null | undefined;
  vitesse: number | null | undefined;
  precedente: Point | null;
  actuelle: Point;
  ligne?: readonly [number, number][] | null;
}): number | null {
  if (e.capGps != null && Number.isFinite(e.capGps) && (e.vitesse ?? 0) > VITESSE_CAP_GPS) return normaliserCap(e.capGps);
  if (e.precedente && distanceM(e.precedente, e.actuelle) >= DEPLACEMENT_CAP_M) return capEntre(e.precedente, e.actuelle);
  return e.ligne ? capDuTrace(e.actuelle, e.ligne) : null;
}

/** Zoom en ville ou à l'arrêt, et à 90 km/h. */
export const ZOOM_VILLE = 17.5;
export const ZOOM_ROUTE = 15.5;
const V_VILLE = 20 / 3.6;
const V_ROUTE = 90 / 3.6;

/** Zoom adapté à la vitesse (m/s) : 17,5 jusqu'à 20 km/h, 15,5 dès 90 km/h, linéaire entre les deux. */
export function zoomSelonVitesse(vitesse: number | null | undefined): number {
  const v = vitesse != null && Number.isFinite(vitesse) && vitesse > 0 ? vitesse : 0;
  if (v <= V_VILLE) return ZOOM_VILLE;
  if (v >= V_ROUTE) return ZOOM_ROUTE;
  return ZOOM_VILLE - ((v - V_VILLE) / (V_ROUTE - V_VILLE)) * (ZOOM_VILLE - ZOOM_ROUTE);
}

/** Lissage du zoom (évite le « pompage » quand la vitesse varie). */
export function lisserZoom(precedent: number | null, cible: number, facteur = 0.35): number {
  if (precedent === null || !Number.isFinite(precedent)) return cible;
  return precedent + (cible - precedent) * facteur;
}

/** Vitesse (m/s) : celle du GPS, sinon déduite des deux dernières positions. */
export function vitesseEstimee(gps: number | null | undefined, precedente: (Point & { t: number }) | null, actuelle: Point & { t: number }): number | null {
  if (gps != null && Number.isFinite(gps) && gps >= 0) return gps;
  if (!precedente || actuelle.t <= precedente.t) return null;
  return distanceM(precedente, actuelle) / ((actuelle.t - precedente.t) / 1000);
}

export interface EtatCamera {
  lng: number;
  lat: number;
  cap: number;
  zoom: number;
}

/** État intermédiaire (k ∈ [0, 1]) entre deux positions : linéaire, cap par le plus court chemin. */
export function interpoler(de: EtatCamera, vers: EtatCamera, k: number): EtatCamera {
  const t = Math.max(0, Math.min(1, k));
  return {
    lng: de.lng + (vers.lng - de.lng) * t,
    lat: de.lat + (vers.lat - de.lat) * t,
    cap: normaliserCap(de.cap + ecartCap(de.cap, vers.cap) * t),
    zoom: de.zoom + (vers.zoom - de.zoom) * t,
  };
}

/** Durée (ms) de l'animation vers la nouvelle position : l'intervalle entre deux points GPS, borné. */
export function dureeAnimation(intervalleMs: number | null, reduit = false): number {
  if (reduit) return 150;
  if (intervalleMs === null || !Number.isFinite(intervalleMs)) return 1000;
  return Math.max(300, Math.min(2000, intervalleMs));
}

/**
 * Marges de la caméra en vue conduite : la voiture (centre de la carte) se
 * place aux ~3/4 de la hauteur visible entre le bandeau du haut et la
 * feuille du bas, pour voir loin devant.
 */
export function margesConduite(hauteurEcran: number, hauteurFeuille: number, basBandeau: number, position = 0.75) {
  const bas = Math.max(0, Math.min(hauteurFeuille, hauteurEcran * 0.7)) + 10;
  const hautFeuille = hauteurEcran - bas;
  const zone = Math.max(0, hautFeuille - basBandeau);
  const centre = basBandeau + zone * position;
  // Le centre de la carte est au milieu de [haut, hauteurEcran - bas].
  const haut = Math.max(0, Math.min(2 * centre - hautFeuille, hautFeuille - 40));
  return { top: Math.round(haut), bottom: Math.round(bas), left: 0, right: 0 };
}
