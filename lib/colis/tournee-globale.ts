/**
 * Optimisation globale d'une tournée à plusieurs villages : toutes les
 * listes (une par village, plus « Hors tournée ») s'enchaînent dans un
 * seul sens de tournée.
 *
 * 1. Ordre des villages : chaque village est représenté par son arrêt
 *    « central » (médoïde) ; on résout le voyageur de commerce sur ces
 *    représentants depuis le dépôt (optimiserOrdre), puis on compare cet
 *    ordre, son inverse et l'ordre actuel en calculant la tournée complète
 *    (sequenceParListes : chaque village optimisé à son tour, en partant du
 *    dernier arrêt du village précédent), et on améliore par déplacements
 *    d'un village (Or-opt) tant que le budget de calcul le permet.
 * 2. Ordre dans chaque village : sequenceParListes, avec les horaires des
 *    adresses pro (lib/colis/horaires.ts) lors du calcul final.
 *
 * Les distances viennent de la matrice routière (km réels) fournie par
 * l'appelant ; repli géographique sinon. Purement fonctionnel (testé dans
 * lib/colis/__tests__/tournee-globale.test.ts).
 */
import { distanceEstimee, optimiserOrdre, type Point } from "@/lib/colis/optimisation";
import { sequenceParListes, type ArretOptimisable, type Liste } from "@/lib/colis/listes";

/** Garde-fou (ms) de la recherche locale sur l'ordre des villages. */
const BUDGET_MS = 1200;

const pointDe = (s: ArretOptimisable): Point | null => (s.lat === null || s.lng === null ? null : { lat: Number(s.lat), lng: Number(s.lng) });

/** Arrêt le plus « central » d'un groupe : somme des distances aux autres minimale. */
export function medoide(points: Point[], distance: (a: Point, b: Point) => number = distanceEstimee): Point | null {
  if (!points.length) return null;
  if (points.length <= 2) return points[0]!;
  let meilleur = points[0]!;
  let cout = Infinity;
  for (const p of points) {
    let c = 0;
    for (const q of points) if (p !== q) c += distance(p, q);
    if (c < cout) {
      cout = c;
      meilleur = p;
    }
  }
  return meilleur;
}

export interface OrdreGlobal {
  /** Listes dans l'ordre retenu, positions renumérotées 0, 1, 2… */
  listes: Liste[];
  /** Km (routiers si matrice) de la tournée complète avec cet ordre, sans horaires. */
  km: number;
  /** Km avec l'ordre des listes d'origine (pour comparaison). */
  kmOrdreActuel: number;
}

/**
 * Ordre global des listes (villages) d'une tournée. Les listes sans arrêt
 * restant localisé gardent leur ordre relatif, après les autres. La liste
 * implicite (arrêts sans liste) reste toujours en tête (grouperParListe).
 */
export function ordonnerListesGlobalement(
  arrets: ArretOptimisable[],
  listes: Liste[],
  depart: Point | null,
  retour: boolean,
  distance: (a: Point, b: Point) => number = distanceEstimee,
): OrdreGlobal {
  const triees = [...listes].sort((a, b) => a.position - b.position);
  const pendants = arrets.filter((s) => s.status === "pending" && pointDe(s));
  const parListe = new Map<string, Point[]>();
  for (const s of pendants) if (s.list_id) parListe.set(s.list_id, [...(parListe.get(s.list_id) ?? []), pointDe(s)!]);
  const actives = triees.filter((l) => parListe.has(l.id));
  const vides = triees.filter((l) => !parListe.has(l.id));
  const kmActuel = sequenceParListes(arrets, triees, depart, retour, undefined, distance).kmApres;
  if (actives.length <= 1) return { listes: [...actives, ...vides].map((l, i) => ({ ...l, position: i })), km: kmActuel, kmOrdreActuel: kmActuel };

  // Évaluation avec la distance de l'appelant (matrice routière).
  const kmDe = (ordre: Liste[]) =>
    sequenceParListes(
      arrets,
      [...ordre, ...vides].map((l, i) => ({ ...l, position: i })),
      depart,
      retour,
      undefined,
      distance,
    ).kmApres;

  const representants = actives.map((l) => medoide(parListe.get(l.id)!, distance)!);
  const tsp = optimiserOrdre(depart, representants, retour, null, distance).map((k) => actives[k]!);
  const candidats = [tsp, [...tsp].reverse(), actives];
  let meilleur = candidats[0]!;
  let meilleurKm = Infinity;
  for (const c of candidats) {
    const km = kmDe(c);
    if (km + 1e-9 < meilleurKm) {
      meilleur = c;
      meilleurKm = km;
    }
  }

  // Or-opt sur l'ordre des villages : déplacer un village ailleurs s'il raccourcit la tournée.
  const t0 = Date.now();
  let ameliore = true;
  while (ameliore && Date.now() - t0 < BUDGET_MS) {
    ameliore = false;
    for (let i = 0; i < meilleur.length && !ameliore; i++) {
      const sans = [...meilleur.slice(0, i), ...meilleur.slice(i + 1)];
      for (let p = 0; p <= sans.length; p++) {
        if (p === i) continue;
        const essai = [...sans.slice(0, p), meilleur[i]!, ...sans.slice(p)];
        const km = kmDe(essai);
        if (km + 1e-6 < meilleurKm) {
          meilleur = essai;
          meilleurKm = km;
          ameliore = true;
          break;
        }
        if (Date.now() - t0 > BUDGET_MS) break;
      }
    }
  }

  return { listes: [...meilleur, ...vides].map((l, i) => ({ ...l, position: i })), km: meilleurKm, kmOrdreActuel: kmDe(actives) };
}
