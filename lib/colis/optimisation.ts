/**
 * Ordre de passage d'une tournée de livraison : variante du problème du
 * voyageur de commerce, résolue par heuristiques (plus proche voisin,
 * puis améliorations 2-opt et Or-opt). Le moteur accepte une matrice de
 * distances routières (OSRM) et retombe sur une estimation géographique
 * corrigée d'un facteur routier si le service n'est pas disponible.
 */

export interface Point {
  lat: number;
  lng: number;
}

/** Repli estimatif : ~1,3 × la distance à vol d'oiseau si aucune matrice routière n'est disponible. */
export const FACTEUR_ROUTIER = 1.3;
export const distanceEstimee = (a: Point, b: Point) => distanceKm(a, b) * FACTEUR_ROUTIER;

export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longueur d'un parcours départ → arrêts dans l'ordre (→ retour au départ si demandé). */
export function longueurParcours(depart: Point | null, arrets: Point[], retour: boolean, distance: (a: Point, b: Point) => number = distanceEstimee): number {
  let total = 0;
  let prev = depart;
  for (const p of arrets) {
    if (prev) total += distance(prev, p);
    prev = p;
  }
  if (retour && depart && prev) total += distance(prev, depart);
  return total;
}

/** Longueur d'un chemin départ → arrêts → point d'arrivée (null : pas de trajet final). */
export function longueurChemin(depart: Point | null, arrets: Point[], fin: Point | null, distance: (a: Point, b: Point) => number = distanceEstimee): number {
  let total = 0;
  let prev = depart;
  for (const p of arrets) {
    if (prev) total += distance(prev, p);
    prev = p;
  }
  if (fin && prev) total += distance(prev, fin);
  return total;
}

/** Deux points au même endroit (≈ 1 m) : un retour « au départ » referme la boucle. */
export function memePoint(a: Point | null, b: Point | null): boolean {
  return Boolean(a && b && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5);
}

/**
 * Renvoie les indices des arrêts dans l'ordre optimisé. `depart` est le
 * dépôt (ou la position du chauffeur) ; `retour` ferme la boucle vers lui.
 * `arrivee` (facultatif) : point d'arrivée imposé, différent du départ —
 * dernière liste d'une tournée qui revient au dépôt (lib/colis/listes.ts).
 */
export function optimiserOrdre(depart: Point | null, arrets: Point[], retour = true, arrivee: Point | null = null, distance: (a: Point, b: Point) => number = distanceKm): number[] {
  const n = arrets.length;
  if (n <= 1 || (n <= 2 && !arrivee)) return arrets.map((_, i) => i);

  // Nœud 0 = départ (ou premier arrêt s'il n'y a pas de départ).
  const pts: Point[] = depart ? [depart, ...arrets] : arrets;
  const offset = depart ? 1 : 0;
  const m = pts.length;
  const d: number[][] = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 0 : distance(pts[i]!, pts[j]!))));
  const ferme = retour && Boolean(depart);
  // Distance de chaque nœud au point d'arrivée imposé (sinon on referme sur le départ).
  const da = arrivee ? pts.map((p) => distance(p, arrivee)) : null;

  // 1. Plus proche voisin depuis le départ.
  const visite = new Array<boolean>(m).fill(false);
  const tour: number[] = [0];
  visite[0] = true;
  for (let k = 1; k < m; k++) {
    const last = tour[tour.length - 1]!;
    let best = -1;
    for (let j = 0; j < m; j++) if (!visite[j] && (best < 0 || d[last]![j]! < d[last]![best]!)) best = j;
    tour.push(best);
    visite[best] = true;
  }

  const cout = (t: number[]) => {
    let c = 0;
    for (let i = 0; i < t.length - 1; i++) c += d[t[i]!]![t[i + 1]!]!;
    if (da) c += da[t[t.length - 1]!]!;
    else if (ferme) c += d[t[t.length - 1]!]![t[0]!]!;
    return c;
  };

  // 2. 2-opt : inverser un segment tant que ça raccourcit (le nœud 0 reste en tête).
  let ameliore = true;
  let garde = 0;
  while (ameliore && garde++ < 200) {
    ameliore = false;
    for (let i = 1; i < m - 1; i++) {
      for (let k = i + 1; k < m; k++) {
        const a = tour[i - 1]!;
        const b = tour[i]!;
        const c = tour[k]!;
        const e = k + 1 < m ? tour[k + 1]! : ferme && !da ? tour[0]! : -1;
        const vers = (x: number) => (e >= 0 ? d[x]![e]! : k + 1 >= m && da ? da[x]! : 0);
        const avant = d[a]![b]! + vers(c);
        const apres = d[a]![c]! + vers(b);
        if (apres + 1e-9 < avant) {
          tour.splice(i, k - i + 1, ...tour.slice(i, k + 1).reverse());
          ameliore = true;
        }
      }
    }
    // 3. Or-opt : déplacer un bloc de 1 à 3 arrêts ailleurs dans le parcours.
    for (let len = 1; len <= 3; len++) {
      for (let i = 1; i + len <= m; i++) {
        const bloc = tour.slice(i, i + len);
        const reste = [...tour.slice(0, i), ...tour.slice(i + len)];
        const base = cout(tour);
        for (let p = 1; p <= reste.length; p++) {
          if (p === i) continue;
          const essai = [...reste.slice(0, p), ...bloc, ...reste.slice(p)];
          if (cout(essai) + 1e-9 < base) {
            tour.splice(0, m, ...essai);
            ameliore = true;
            break;
          }
        }
      }
    }
  }

  return tour.filter((i) => i >= offset).map((i) => i - offset);
}
