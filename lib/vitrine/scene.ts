/**
 * Logique pure de la 3D décorative de la vitrine (accueil) : détection du
 * repli statique, tracé de la tournée, inclinaison des cartes, parallaxe.
 * Aucune dépendance au DOM : les valeurs du navigateur sont passées en
 * paramètre (testable sous node).
 */

export interface EnvironnementScene {
  /** `prefers-reduced-motion: reduce` */
  mouvementReduit: boolean;
  /** navigator.hardwareConcurrency (cœurs logiques), si connu. */
  coeurs?: number | null;
  /** navigator.deviceMemory (Go, valeur arrondie), si connu. */
  memoireGo?: number | null;
  /** navigator.connection.saveData */
  economieDonnees?: boolean;
  /** CSS 3D (preserve-3d + perspective) disponible. Absent = on suppose oui. */
  css3d?: boolean;
}

export type RaisonRepli = "mouvement-reduit" | "faible-puissance" | "economie-donnees" | "3d-indisponible";

const SEUIL_COEURS = 4;
const SEUIL_MEMOIRE_GO = 4;

/** Raison pour laquelle la scène doit rester statique, ou null si elle peut s'animer. */
export function raisonRepli(env: EnvironnementScene): RaisonRepli | null {
  if (env.mouvementReduit) return "mouvement-reduit";
  if (env.economieDonnees) return "economie-donnees";
  if (env.css3d === false) return "3d-indisponible";
  if (typeof env.coeurs === "number" && env.coeurs > 0 && env.coeurs <= SEUIL_COEURS) return "faible-puissance";
  if (typeof env.memoireGo === "number" && env.memoireGo > 0 && env.memoireGo <= SEUIL_MEMOIRE_GO) return "faible-puissance";
  return null;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Courbe lisse passant par tous les points (Catmull-Rom converti en
 * Bézier cubique SVG). `tension` 0 = segments droits, 1 = très arrondi.
 */
export function tracerTournee(points: Point[], tension = 0.5): string {
  const premier = points[0];
  if (!premier) return "";
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = `M${r(premier.x)} ${r(premier.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    const k = tension / 3;
    const c1 = { x: p1.x + (p2.x - p0.x) * k, y: p1.y + (p2.y - p0.y) * k };
    const c2 = { x: p2.x - (p3.x - p1.x) * k, y: p2.y - (p3.y - p1.y) * k };
    d += ` C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(p2.x)} ${r(p2.y)}`;
  }
  return d;
}

/** Longueur de la ligne brisée (borne basse de la courbe), pour cadencer l'animation. */
export function longueurTournee(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}

/** Fraction (0..1) du tracé atteinte à chaque arrêt, pour synchroniser leur apparition. */
export function progressionArrets(points: Point[]): number[] {
  const total = longueurTournee(points);
  if (total === 0) return points.map(() => 0);
  let cumul = 0;
  return points.map((p, i) => {
    if (i > 0) cumul += Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y);
    return Math.round((cumul / total) * 1000) / 1000;
  });
}

/**
 * Inclinaison (degrés) d'une carte selon la position du pointeur dans son
 * rectangle : le pointeur à droite fait pencher la carte vers la droite.
 */
export function inclinaison(px: number, py: number, rect: { left: number; top: number; width: number; height: number }, maxDeg = 8): { rx: number; ry: number } {
  if (rect.width <= 0 || rect.height <= 0) return { rx: 0, ry: 0 };
  const nx = Math.max(-1, Math.min(1, ((px - rect.left) / rect.width) * 2 - 1));
  const ny = Math.max(-1, Math.min(1, ((py - rect.top) / rect.height) * 2 - 1));
  const arrondi = (n: number) => Math.round(n * 100) / 100 || 0;
  return { rx: arrondi(-ny * maxDeg), ry: arrondi(nx * maxDeg) };
}

/**
 * Décalage vertical (px) de la parallaxe : 0 quand l'élément est centré dans
 * la fenêtre, ±`profondeur` px à l'entrée / la sortie. `haut` et `hauteur`
 * viennent de getBoundingClientRect().
 */
export function decalageParallaxe(haut: number, hauteur: number, hauteurFenetre: number, profondeur: number): number {
  if (hauteurFenetre <= 0) return 0;
  const centre = haut + hauteur / 2;
  const t = Math.max(-1, Math.min(1, (centre - hauteurFenetre / 2) / (hauteurFenetre / 2 + hauteur / 2)));
  return Math.round(t * profondeur * 10) / 10 || 0;
}
