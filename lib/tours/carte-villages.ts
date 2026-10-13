/**
 * Carte des villages par tournée — calculs purs (sans réseau ni DOM) :
 * couleurs des tournées, enveloppe convexe (étendue d'une tournée),
 * détection des incohérences (village sur plusieurs tournées, village
 * loin du reste de sa tournée, village non localisé).
 */

export type LngLat = [number, number];

/**
 * Seuils de détection d'un village « isolé » dans sa tournée. Le centre
 * d'une tournée est la médiane des coordonnées (robuste : un village
 * aberrant ne déplace pas le centre). Un village est isolé si sa
 * distance au centre dépasse OUTLIER_RATIO × la distance médiane des
 * villages de la tournée, ou OUTLIER_MAX_KM dans l'absolu — sauf s'il
 * est à moins de OUTLIER_MIN_KM du centre (tournée très groupée : un
 * écart de 2 km n'a rien d'incohérent).
 */
export const OUTLIER_RATIO = 2.5;
export const OUTLIER_MAX_KM = 25;
export const OUTLIER_MIN_KM = 5;
/** En dessous, pas assez de villages pour parler d'un « reste de la tournée ». */
export const OUTLIER_MIN_VILLAGES = 3;

/**
 * Palette qualitative accessible : Okabe-Ito (distinguable par les
 * daltoniens) complétée par la palette « bright »/« muted » de Paul Tol.
 * Le jaune clair d'Okabe-Ito est écarté (illisible sur fond de carte clair).
 */
export const TOUR_PALETTE = [
  "#0072B2", // bleu
  "#E69F00", // orange
  "#009E73", // vert
  "#CC79A7", // rose
  "#D55E00", // vermillon
  "#56B4E9", // bleu ciel
  "#882255", // bordeaux
  "#117733", // vert foncé
  "#332288", // indigo
  "#AA4499", // violet
  "#44AA99", // turquoise
  "#999933", // olive
  "#661100", // brun
  "#6699CC", // bleu gris
] as const;

/** Couleur au-delà de la palette : teintes réparties par l'angle d'or, saturées et assez sombres pour un contour blanc. */
function extraColor(i: number): string {
  const hue = Math.round((i * 137.508) % 360);
  return `hsl(${hue} 65% ${i % 2 ? 38 : 48}%)`;
}

/**
 * Une couleur stable par tournée : triées par numéro (ordre naturel
 * T2 < T10), elles prennent la palette dans l'ordre. La couleur d'une
 * tournée ne dépend donc pas du filtre de service affiché.
 */
export function assignTourColors(tourKeys: string[]): Map<string, string> {
  const sorted = Array.from(new Set(tourKeys)).sort((a, b) => a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" }));
  const colors = new Map<string, string>();
  sorted.forEach((k, i) => colors.set(k, i < TOUR_PALETTE.length ? TOUR_PALETTE[i]! : extraColor(i)));
  return colors;
}

/** Enveloppe convexe (chaîne monotone d'Andrew), sens trigonométrique, sans point répété en fin. */
export function convexHull(points: LngLat[]): LngLat[] {
  const uniq = Array.from(new Map(points.map((p) => [`${p[0]},${p[1]}`, p] as const)).values()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (uniq.length <= 2) return uniq;
  const cross = (o: LngLat, a: LngLat, b: LngLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: LngLat[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: LngLat[] = [];
  for (let i = uniq.length - 1; i >= 0; i--) {
    const p = uniq[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Distance à vol d'oiseau en km. */
export function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Centre robuste d'un nuage de points : médiane des longitudes et des latitudes. */
export function medianCenter(points: LngLat[]): LngLat {
  return [median(points.map((p) => p[0])), median(points.map((p) => p[1]))];
}

/** Nom de commune comparable : sans accents, casse, tirets, apostrophes ; « St » = « Saint ». */
export function normalizeVillageName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[-'’_.,/()]+/g, " ")
    .replace(/\bste\b/g, "sainte")
    .replace(/\bst\b/g, "saint")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MapVillage {
  /** Identifiant de la ligne village (tour_route_villages.id). */
  id: string;
  routeId: string;
  tourNumber: string;
  serviceId: string | null;
  serviceName: string | null;
  name: string;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  inseeCode: string | null;
  /** ok | introuvable | null (pas encore géocodé). */
  geoStatus: string | null;
}

/** Même commune ? Code INSEE si connu (géocodée), sinon nom normalisé. */
export function villageKey(v: Pick<MapVillage, "name" | "inseeCode">): string {
  if (v.inseeCode) return `insee:${v.inseeCode}`;
  return `nom:${normalizeVillageName(v.name)}`;
}

export interface DuplicateIssue {
  key: string;
  name: string;
  /** Les villages concernés (une entrée par tournée). */
  villages: MapVillage[];
  tourNumbers: string[];
  /** Toutes les tournées concernées sont du même service (ou sans service). */
  sameService: boolean;
}

/** Villages présents sur plusieurs tournées. */
export function findDuplicates(villages: MapVillage[]): DuplicateIssue[] {
  const groups = new Map<string, MapVillage[]>();
  for (const v of villages) {
    const k = villageKey(v);
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  const issues: DuplicateIssue[] = [];
  for (const [key, list] of Array.from(groups.entries())) {
    const routeIds = new Set(list.map((v) => v.routeId));
    if (routeIds.size < 2) continue;
    const tourNumbers = Array.from(new Set(list.map((v) => v.tourNumber))).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
    const services = new Set(list.map((v) => v.serviceId ?? ""));
    issues.push({
      key,
      name: list[0]!.name,
      villages: list,
      tourNumbers,
      sameService: services.size === 1,
    });
  }
  return issues.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export interface OutlierIssue {
  village: MapVillage;
  /** Distance au centre de sa tournée, en km. */
  distanceKm: number;
  /** Distance médiane des villages de la tournée à son centre, en km. */
  medianKm: number;
  center: LngLat;
}

/** Le seuil de distance au-delà duquel un village est isolé, pour une distance médiane donnée. */
export function isOutlierDistance(distanceKm: number, medianKm: number): boolean {
  if (distanceKm < OUTLIER_MIN_KM) return false;
  return distanceKm > OUTLIER_MAX_KM || distanceKm > OUTLIER_RATIO * medianKm;
}

/** Villages loin du reste de leur tournée (tournées d'au moins OUTLIER_MIN_VILLAGES villages localisés). */
export function findOutliers(villages: MapVillage[]): OutlierIssue[] {
  const byRoute = new Map<string, MapVillage[]>();
  for (const v of villages) if (v.lat !== null && v.lng !== null) byRoute.set(v.routeId, [...(byRoute.get(v.routeId) ?? []), v]);
  const issues: OutlierIssue[] = [];
  for (const list of Array.from(byRoute.values())) {
    if (list.length < OUTLIER_MIN_VILLAGES) continue;
    const pts = list.map((v) => [v.lng!, v.lat!] as LngLat);
    const center = medianCenter(pts);
    const dists = pts.map((p) => haversineKm(center, p));
    const med = median(dists);
    list.forEach((v, i) => {
      if (isOutlierDistance(dists[i]!, med))
        issues.push({
          village: v,
          distanceKm: dists[i]!,
          medianKm: med,
          center,
        });
    });
  }
  return issues.sort((a, b) => b.distanceKm - a.distanceKm);
}

export interface TourExtent {
  routeId: string;
  /** Points de l'enveloppe ; 1 point = village seul, 2 = segment, 3+ = polygone. */
  hull: LngLat[];
  /** Plus grande distance entre deux villages de la tournée (km). */
  spanKm: number;
}

export function tourExtent(routeId: string, points: LngLat[]): TourExtent {
  const hull = convexHull(points);
  let spanKm = 0;
  for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) spanKm = Math.max(spanKm, haversineKm(hull[i]!, hull[j]!));
  return { routeId, hull, spanKm };
}

export interface VillageAnalysis {
  duplicates: DuplicateIssue[];
  outliers: OutlierIssue[];
  /** Villages sans coordonnées (introuvables ou pas encore géocodés). */
  unlocated: MapVillage[];
  extents: Map<string, TourExtent>;
}

export function analyzeVillages(villages: MapVillage[]): VillageAnalysis {
  const located = villages.filter((v) => v.lat !== null && v.lng !== null);
  const byRoute = new Map<string, LngLat[]>();
  for (const v of located) byRoute.set(v.routeId, [...(byRoute.get(v.routeId) ?? []), [v.lng!, v.lat!]]);
  const extents = new Map<string, TourExtent>();
  for (const [routeId, pts] of Array.from(byRoute.entries())) extents.set(routeId, tourExtent(routeId, pts));
  return {
    duplicates: findDuplicates(villages),
    outliers: findOutliers(villages),
    unlocated: villages.filter((v) => v.lat === null || v.lng === null),
    extents,
  };
}
