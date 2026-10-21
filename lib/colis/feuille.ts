// GO Navigation, feuille de la tournée (en bas de l'écran) : trois
// positions, comme Google Maps / Waze. Logique pure, testée dans
// lib/colis/__tests__/feuille.test.ts.
//  - réduite : une ligne (n° d'arrêt, adresse courte, « Livré », « ⋯ ») ;
//    la carte occupe presque tout l'écran ;
//  - moyenne : la carte de l'arrêt (compacte), arrêts suivants en défilement
//    horizontal ; ≈ 40 % de l'écran au plus ;
//  - pleine : liste complète, réordonnable.

import type { Point } from "@/lib/colis/itineraire";
import { longueursCumulees, projeterSurTrace } from "@/lib/colis/navigation";

export type PositionFeuille = "reduite" | "moyenne" | "pleine";
export const POSITIONS_FEUILLE: readonly PositionFeuille[] = ["reduite", "moyenne", "pleine"];

/** Mémorisée sur le téléphone (réduite ou moyenne ; la liste pleine n'est qu'un passage). */
export const CLE_FEUILLE = "godac.go-navigation.feuille";
/**
 * Par défaut en conduite : réduite. Le chauffeur voit la route sur presque
 * tout l'écran, « Livré » reste à un geste ; la carte de l'arrêt (appel,
 * horaires, échec) est à une poignée près.
 */
export const FEUILLE_PAR_DEFAUT: PositionFeuille = "reduite";

/** Hauteur de la ligne réduite (px, hors zone de sécurité du bas). */
export const HAUTEUR_REDUITE_PX = 80;
/** Part de l'écran au plus : moyenne, pleine. */
export const PART_MOYENNE = 0.4;
export const PART_PLEINE = 0.85;
/** Glissement minimal (px) pour changer de position ; sous ce seuil, c'est un appui. */
export const SEUIL_GLISSE_PX = 30;

/** Position relue depuis le stockage local ; inconnue ou « pleine » : position par défaut. */
export function lirePositionFeuille(v: string | null | undefined): PositionFeuille {
  return v === "reduite" || v === "moyenne" ? v : FEUILLE_PAR_DEFAUT;
}

/**
 * Position après un geste sur la poignée (dy en px, négatif vers le haut).
 * Un long glissement (plus d'un tiers de l'écran) saute une position ; un
 * simple appui alterne : réduite ↔ moyenne, et pleine redescend en moyenne.
 */
export function positionApresGeste(actuelle: PositionFeuille, dy: number, hauteurEcran = 800): PositionFeuille {
  const i = POSITIONS_FEUILLE.indexOf(actuelle);
  if (Math.abs(dy) < SEUIL_GLISSE_PX) return actuelle === "reduite" ? "moyenne" : actuelle === "moyenne" ? "reduite" : "moyenne";
  const pas = Math.abs(dy) > hauteurEcran / 3 ? 2 : 1;
  const k = Math.max(0, Math.min(POSITIONS_FEUILLE.length - 1, i + (dy < 0 ? pas : -pas)));
  return POSITIONS_FEUILLE[k]!;
}

/** Hauteur maximale (px) de la feuille dans cette position. */
export function hauteurMaxFeuille(position: PositionFeuille, hauteurEcran: number): number {
  if (position === "reduite") return HAUTEUR_REDUITE_PX;
  if (position === "moyenne") return Math.round(Math.max(220, hauteurEcran * PART_MOYENNE));
  return Math.round(hauteurEcran * PART_PLEINE);
}

const normaliser = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** La ligne secondaire (client, enseigne) ne fait-elle que répéter l'adresse ? */
export function repeteAdresse(secondaire: string | null | undefined, adresse: string): boolean {
  if (!secondaire || !secondaire.trim()) return true;
  const s = normaliser(secondaire);
  const a = normaliser(adresse);
  return s.length > 0 && (a === s || a.startsWith(`${s} `) || a.includes(` ${s} `) || a.endsWith(` ${s}`));
}

/** Adresse courte pour la ligne réduite : avant le code postal / la virgule (« 13 Imp. Paul Valéry »). */
export function adresseCourte(adresse: string): string {
  const avantVirgule = adresse.split(",")[0]!.trim();
  return avantVirgule || adresse.trim();
}

/**
 * Tracé vers l'arrêt découpé à la position projetée du véhicule : partie
 * parcourue (du début du tracé au véhicule) et partie restante (du
 * véhicule à l'arrêt). Sans position ou tracé trop court : tout est restant.
 */
export function decouperTrace(
  ligne: readonly [number, number][],
  position: Point | null,
  cumul: readonly number[] = longueursCumulees(ligne),
): { parcouru: [number, number][]; restant: [number, number][] } {
  const proj = position && ligne.length >= 2 ? projeterSurTrace(position, ligne, cumul) : null;
  if (!proj) return { parcouru: [], restant: [...ligne] };
  const i = proj.segment;
  const a = ligne[i - 1]!;
  const b = ligne[i]!;
  const long = cumul[i]! - cumul[i - 1]!;
  const t = long > 0 ? (proj.abscisseM - cumul[i - 1]!) / long : 0;
  const p: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return { parcouru: [...ligne.slice(0, i), p], restant: [p, ...ligne.slice(i)] };
}
