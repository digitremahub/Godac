/**
 * Matrice des distances routières (km réels) d'une tournée colis, calculée
 * côté serveur pour l'optimisation (app/api/colis/optimiser).
 *
 * Service : API « table » compatible OSRM (ROUTING_URL, par défaut le
 * serveur public router.project-osrm.org, sans clé). Le serveur public
 * limite le nombre de points par requête : au-delà de TAILLE_BLOC points,
 * la matrice est découpée en blocs (sources × destinations) et assemblée.
 * Chaque paire calculée est mise en cache en mémoire (les réoptimisations
 * en cours de route reposent les mêmes questions). Toute paire manquante
 * (service indisponible, tournée trop grande, point non routable) retombe
 * sur l'estimation à vol d'oiseau × 1,3 (distanceEstimee), et l'appelant
 * est prévenu (`estimation`).
 *
 * Ce module ne fait aucun appel côté navigateur (la CSP connect-src n'a
 * pas à autoriser le service de routage).
 */
import { distanceEstimee, type Point } from "@/lib/colis/optimisation";

/** Points par bloc : un bloc source + un bloc destination = au plus 2 × 45 = 90 coordonnées par requête. */
export const TAILLE_BLOC = 45;
/** Au-delà, on ne sollicite pas le service public (trop de requêtes) : repli estimatif. */
export const POINTS_MAX = 220;
const TTL_MS = 12 * 3600_000;
const CACHE_MAX = 60_000;

export const clePoint = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/** Découpe n points en blocs [début, fin[ de `taille`, et la liste des couples de blocs à demander. */
export function planifierBlocs(n: number, taille = TAILLE_BLOC): { blocs: [number, number][]; requetes: [number, number][] } {
  const blocs: [number, number][] = [];
  for (let i = 0; i < n; i += taille) blocs.push([i, Math.min(n, i + taille)]);
  const requetes: [number, number][] = [];
  for (let a = 0; a < blocs.length; a++) for (let b = 0; b < blocs.length; b++) requetes.push([a, b]);
  return { blocs, requetes };
}

const cache = new Map<string, { km: number; t: number }>();

function lireCache(a: Point, b: Point): number | undefined {
  const e = cache.get(`${clePoint(a)}>${clePoint(b)}`);
  if (!e) return undefined;
  if (Date.now() - e.t > TTL_MS) {
    cache.delete(`${clePoint(a)}>${clePoint(b)}`);
    return undefined;
  }
  return e.km;
}

function ecrireCache(a: Point, b: Point, km: number) {
  if (cache.size >= CACHE_MAX) {
    // Évince les plus anciennes entrées (ordre d'insertion).
    let n = Math.ceil(CACHE_MAX / 10);
    for (const k of cache.keys()) {
      cache.delete(k);
      if (--n <= 0) break;
    }
  }
  cache.set(`${clePoint(a)}>${clePoint(b)}`, { km, t: Date.now() });
}

async function requeteTable(base: string, sources: Point[], destinations: Point[]): Promise<(number | null)[][] | null> {
  const memes = sources === destinations;
  const pts = memes ? sources : [...sources, ...destinations];
  const coords = pts.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const params = new URLSearchParams({ annotations: "distance" });
  if (!memes) {
    params.set("sources", sources.map((_, i) => i).join(";"));
    params.set("destinations", destinations.map((_, i) => sources.length + i).join(";"));
  }
  try {
    const res = await fetch(`${base}/table/v1/driving/${coords}?${params}`, {
      headers: { "User-Agent": "GODAC (https://godac.app)" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { code?: string; distances?: (number | null)[][] };
    return data.code === "Ok" && data.distances ? data.distances : null;
  } catch {
    return null;
  }
}

export interface MatriceRoutiere {
  /** Distance routière (km) ; estimation si la paire n'a pas pu être calculée. */
  distance: (a: Point, b: Point) => number;
  /** true dès qu'une distance demandée a dû être estimée. */
  estimation: () => boolean;
  /** Paires calculées par le service / total des paires. */
  couverture: number;
}

/**
 * Matrice routière entre tous les points (dédoublonnés). Ne lève jamais :
 * service indisponible = repli estimatif paire par paire.
 */
export async function matriceRoutiere(points: Point[], base = process.env.ROUTING_URL ?? "https://router.project-osrm.org"): Promise<MatriceRoutiere> {
  const uniques = [...new Map(points.map((p) => [clePoint(p), p])).values()];
  const n = uniques.length;
  const manquantes = new Set<number>();
  if (n >= 2 && n <= POINTS_MAX) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && lireCache(uniques[i]!, uniques[j]!) === undefined) manquantes.add(i);
  }
  if (manquantes.size) {
    const { blocs, requetes } = planifierBlocs(n);
    // Deux requêtes à la fois au plus : on reste poli avec le service public.
    let k = 0;
    const travail = async () => {
      while (k < requetes.length) {
        const [a, b] = requetes[k++]!;
        const src = uniques.slice(...blocs[a]!);
        const dst = a === b ? src : uniques.slice(...blocs[b]!);
        // Bloc entièrement en cache : rien à demander.
        if (src.every((p) => dst.every((q) => p === q || lireCache(p, q) !== undefined))) continue;
        const m = await requeteTable(base, src, dst);
        if (!m) continue;
        src.forEach((p, i) =>
          dst.forEach((q, j) => {
            const metres = m[i]?.[j];
            if (typeof metres === "number" && Number.isFinite(metres)) ecrireCache(p, q, metres / 1000);
          }),
        );
      }
    };
    await Promise.all([travail(), travail()]);
  }
  let estimee = false;
  let calculees = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && lireCache(uniques[i]!, uniques[j]!) !== undefined) calculees++;
  return {
    distance: (a, b) => {
      if (clePoint(a) === clePoint(b)) return 0;
      const km = lireCache(a, b);
      if (km !== undefined) return km;
      estimee = true;
      return distanceEstimee(a, b);
    },
    estimation: () => estimee,
    couverture: n > 1 ? calculees / (n * (n - 1)) : 1,
  };
}
