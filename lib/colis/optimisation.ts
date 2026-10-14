
/**
 * Optimisation de l'ordre des arrêts d'une tournée.
 * Utilise les distances routières fournies par OSRM lorsqu'elles sont disponibles.
 */

export interface Point {
  lat: number;
  lng: number;
}

export const FACTEUR_ROUTIER = 1.3;

export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const distanceEstimee = (a: Point, b: Point) =>
  distanceKm(a, b) * FACTEUR_ROUTIER;

export function longueurParcours(
  depart: Point | null,
  arrets: Point[],
  retour: boolean,
  distance: (a: Point, b: Point) => number = distanceEstimee
): number {
  let total = 0;
  let precedent = depart;

  for (const arret of arrets) {
    if (precedent) total += distance(precedent, arret);
    precedent = arret;
  }

  if (retour && depart && precedent) {
    total += distance(precedent, depart);
  }

  return total;
}

export function optimiserOrdre(
  depart: Point | null,
  arrets: Point[],
  retour = true,
  arrivee: Point | null = null,
  distance: (a: Point, b: Point) => number = distanceKm
): number[] {
  const n = arrets.length;

  if (n <= 1) return arrets.map((_, i) => i);

  const points = depart ? [depart, ...arrets] : [...arrets];
  const decalage = depart ? 1 : 0;
  const m = points.length;

  const matrice = points.map((a, i) =>
    points.map((b, j) =>
      i === j ? 0 : distance(a, b)
    )
  );

  const ferme = retour && Boolean(depart);

  const cout = (tour: number[]) => {
    let total = 0;

    for (let i = 0; i < tour.length - 1; i++) {
      total += matrice[tour[i]!]![tour[i + 1]!]!;
    }

    const dernier = tour[tour.length - 1]!;

    if (arrivee) {
      total += distance(points[dernier]!, arrivee);
    } else if (ferme) {
      total += matrice[dernier]![tour[0]!]!;
    }

    return total;
  };

  // Recherche du plus proche voisin.
  const visite = new Array<boolean>(m).fill(false);
  const tour = [0];
  visite[0] = true;

  while (tour.length < m) {
    const dernier = tour[tour.length - 1]!;
    let meilleur = -1;

    for (let j = 0; j < m; j++) {
      if (
        !visite[j] &&
        (meilleur === -1 ||
          matrice[dernier]![j]! < matrice[dernier]![meilleur]!)
      ) {
        meilleur = j;
      }
    }

    if (meilleur === -1) break;

    tour.push(meilleur);
    visite[meilleur] = true;
  }

  // Amélioration 2-opt.
  let ameliore = true;
  let iterations = 0;

  while (ameliore && iterations++ < 100) {
    ameliore = false;

    for (let i = 1; i < tour.length - 1; i++) {
      for (let k = i + 1; k < tour.length; k++) {
        const essai = [...tour];
        essai.splice(i, k - i + 1, ...essai.slice(i, k + 1).reverse());

        if (cout(essai) < cout(tour) - 1e-9) {
          tour.splice(0, tour.length, ...essai);
          ameliore = true;
        }
      }
    }
  }

  return tour
    .filter((index) => index >= decalage)
    .map((index) => index - decalage);
}
