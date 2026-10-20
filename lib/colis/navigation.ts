// GO Navigation (écran de navigation du chauffeur) : logique pure, testée
// dans lib/colis/__tests__/navigation.test.ts.
//  - arrêt suivi (celui de la carte affichée, ou le prochain à faire) et
//    passage automatique au suivant quand il est clôturé ;
//  - écart entre la position GPS et le tracé, et décision de recalculer
//    l'itinéraire ;
//  - insertion d'une adresse ajoutée en cours de tournée au meilleur endroit
//    parmi les arrêts restants de son village (liste).

import { haversineKm, type Point } from "@/lib/colis/itineraire";
import type { CibleDepot } from "@/lib/colis/reordonner";

interface ArretNav {
  id: string;
  status: string;
}

/**
 * Arrêt vers lequel on navigue : celui choisi (carte affichée) s'il est
 * encore à faire, sinon le premier arrêt restant dans l'ordre. Clôturer
 * l'arrêt suivi fait donc passer automatiquement au suivant.
 */
export function arretSuivi<T extends ArretNav>(stops: readonly T[], selection: string | null): T | null {
  const choisi = selection ? stops.find((s) => s.id === selection && s.status === "pending") : undefined;
  return choisi ?? stops.find((s) => s.status === "pending") ?? null;
}

/**
 * Arrêt à suivre après la clôture de `clotureId` : le premier restant placé
 * APRÈS lui dans l'ordre, sinon le premier restant (arrêts laissés avant).
 */
export function arretApresCloture<T extends ArretNav>(stops: readonly T[], clotureId: string): T | null {
  const i = stops.findIndex((s) => s.id === clotureId);
  const restants = (s: T) => s.status === "pending" && s.id !== clotureId;
  return (i >= 0 ? stops.slice(i + 1).find(restants) : undefined) ?? stops.find(restants) ?? null;
}

/** Distance en mètres d'un point à un segment (projection plane locale, suffisante à l'échelle d'une rue). */
function distanceSegmentM(p: Point, a: [number, number], b: [number, number]): number {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  const ax = (a[0] - p.lng) * kx;
  const ay = (a[1] - p.lat) * ky;
  const bx = (b[0] - p.lng) * kx;
  const by = (b[1] - p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Écart (m) entre la position et le tracé [lng, lat][] ; Infinity sans tracé. */
export function ecartAuTrace(position: Point, ligne: readonly [number, number][]): number {
  if (ligne.length === 0) return Infinity;
  if (ligne.length === 1) return distanceSegmentM(position, ligne[0]!, ligne[0]!);
  let min = Infinity;
  for (let i = 1; i < ligne.length; i++) min = Math.min(min, distanceSegmentM(position, ligne[i - 1]!, ligne[i]!));
  return min;
}

/** Au-delà de cet écart au tracé, le chauffeur a quitté l'itinéraire. */
export const ECART_MAX_M = 60;
/** Délai minimal entre deux recalculs pour un simple écart (ménage le service d'itinéraires). */
export const DELAI_RECALCUL_MS = 20_000;
/** Rayon d'arrivée à l'arrêt. */
export const RAYON_ARRIVEE_M = 60;

/**
 * Faut-il recalculer l'itinéraire vers l'arrêt suivi ? Oui si l'arrêt a
 * changé (clôture, choix d'une autre carte) ou s'il n'y a pas encore de
 * tracé ; oui si le chauffeur s'est écarté du tracé, au plus toutes les
 * DELAI_RECALCUL_MS.
 */
export function doitRecalculer(e: {
  cible: string | null;
  cibleTracee: string | null;
  ligne: readonly [number, number][] | null;
  position: Point | null;
  dernierCalcul: number;
  maintenant: number;
}): boolean {
  if (!e.cible) return false;
  if (e.cible !== e.cibleTracee || !e.ligne) return true;
  if (!e.position || e.maintenant - e.dernierCalcul < DELAI_RECALCUL_MS) return false;
  return ecartAuTrace(e.position, e.ligne) > ECART_MAX_M;
}

/** Distance à vol d'oiseau en mètres. */
export const distanceM = (a: Point, b: Point) => haversineKm(a, b) * 1000;

export function formatDistance(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres) || metres < 0) return "—";
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  return `${(metres / 1000).toLocaleString("fr-FR", { maximumFractionDigits: metres < 10_000 ? 1 : 0 })} km`;
}

export function formatDuree(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export interface ArretInsertion {
  id: string;
  status: string;
  list_id?: string | null;
  lat: number | string | null;
  lng: number | string | null;
}

const point = (a: { lat: number | string | null; lng: number | string | null }): Point | null =>
  a.lat === null || a.lng === null || a.lat === "" || a.lng === "" ? null : { lat: Number(a.lat), lng: Number(a.lng) };

/** Distance entre deux points connus ; 0 si l'un manque (sans effet sur le choix). */
const d = (a: Point | null, b: Point | null) => (a && b ? haversineKm(a, b) : 0);

/**
 * Meilleur endroit où placer un arrêt ajouté en cours de tournée : parmi
 * les arrêts RESTANTS de sa liste (village), la place qui allonge le moins
 * le trajet (insertion la moins coûteuse, distances à vol d'oiseau), départ
 * depuis la position du chauffeur si elle est connue. Renvoie la cible du
 * glisser-déposer (PATCH /api/colis/arrets/[id] { deposer }) : devant un
 * arrêt de la liste, ou en fin de liste. Sans coordonnées : null (l'arrêt
 * reste où l'API l'a mis, en fin de tournée).
 */
export function meilleureInsertion(
  stops: readonly ArretInsertion[],
  nouveau: ArretInsertion,
  depart: Point | null = null,
): { cible: CibleDepot; rang: number; detourKm: number } | null {
  const p = point(nouveau);
  if (!p) return null;
  const liste = nouveau.list_id ?? null;
  const restants = stops.filter((s) => s.status === "pending" && s.id !== nouveau.id);
  let meilleur: { cible: CibleDepot; rang: number; detourKm: number } | null = null;
  const dernierDeLaListe = restants.reduce((k, s, i) => ((s.list_id ?? null) === liste ? i : k), -1);
  for (let i = 0; i <= restants.length; i++) {
    const suivant = restants[i];
    const memeListe = suivant !== undefined && (suivant.list_id ?? null) === liste;
    // Places possibles : devant un arrêt de la même liste, ou juste après
    // son dernier arrêt (fin de liste). Liste sans arrêt restant : en fin.
    const finDeListe = dernierDeLaListe >= 0 ? i === dernierDeLaListe + 1 : i === restants.length;
    if (!memeListe && !finDeListe) continue;
    const prec = i === 0 ? depart : point(restants[i - 1]!);
    const suiv = suivant ? point(suivant) : null;
    const detour = d(prec, p) + d(p, suiv) - d(prec, suiv);
    if (!meilleur || detour < meilleur.detourKm - 1e-9) {
      meilleur = { cible: { list_id: liste, avant_id: memeListe ? suivant!.id : null }, rang: i, detourKm: Math.round(detour * 100) / 100 };
    }
  }
  return meilleur;
}

/**
 * Distance restante (m) le long du tracé depuis la position : du point du
 * tracé le plus proche jusqu'à son extrémité. Sert à afficher « 2,3 km ·
 * 6 min » pendant que le chauffeur avance, sans rappeler le serveur.
 */
export function resteSurTrace(position: Point, ligne: readonly [number, number][]): number | null {
  if (ligne.length < 2) return null;
  let meilleur = 0;
  let min = Infinity;
  for (let i = 1; i < ligne.length; i++) {
    const e = distanceSegmentM(position, ligne[i - 1]!, ligne[i]!);
    if (e < min) {
      min = e;
      meilleur = i;
    }
  }
  const pt = (c: [number, number]): Point => ({ lat: c[1], lng: c[0] });
  let reste = distanceM(position, pt(ligne[meilleur]!));
  for (let i = meilleur + 1; i < ligne.length; i++) reste += distanceM(pt(ligne[i - 1]!), pt(ligne[i]!));
  return reste;
}

/** Projection d'un point sur un segment : distance (m) et position relative t ∈ [0, 1]. */
function projectionSegment(p: Point, a: [number, number], b: [number, number]): { ecartM: number; t: number } {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  const ax = (a[0] - p.lng) * kx;
  const ay = (a[1] - p.lat) * ky;
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * ky;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
  return { ecartM: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/** Longueurs cumulées (m) du tracé à chacun de ses sommets. */
export function longueursCumulees(ligne: readonly [number, number][]): number[] {
  const cumul = [0];
  for (let i = 1; i < ligne.length; i++) {
    const a = ligne[i - 1]!;
    const b = ligne[i]!;
    cumul.push(cumul[i - 1]! + distanceM({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }));
  }
  return cumul;
}

/**
 * Projection de la position sur le tracé : distance parcourue depuis le
 * début du tracé (abscisse, m), segment le plus proche et écart (m). Le
 * paramètre `apres` limite la recherche aux segments à partir de cet
 * indice (manœuvres placées dans l'ordre, même si le tracé repasse au même
 * endroit). null sans tracé.
 */
export function projeterSurTrace(
  position: Point,
  ligne: readonly [number, number][],
  cumul: readonly number[] = longueursCumulees(ligne),
  apres = 1,
): { abscisseM: number; segment: number; ecartM: number } | null {
  if (ligne.length < 2) return null;
  let meilleur: { abscisseM: number; segment: number; ecartM: number } | null = null;
  for (let i = Math.max(1, apres); i < ligne.length; i++) {
    const { ecartM, t } = projectionSegment(position, ligne[i - 1]!, ligne[i]!);
    if (!meilleur || ecartM < meilleur.ecartM - 1e-6) {
      meilleur = { abscisseM: cumul[i - 1]! + t * (cumul[i]! - cumul[i - 1]!), segment: i, ecartM };
    }
  }
  return meilleur;
}
