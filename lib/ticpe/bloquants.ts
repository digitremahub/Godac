/**
 * Points bloquants et génération des documents (3310-TIC, ERA, dossier ZIP) —
 * pur, testé. Tant qu'il reste des points bloquants, la génération est refusée,
 * sauf si la personne confirme explicitement « je génère malgré N points
 * bloquants » (N = le nombre affiché). Le document porte alors la mention
 * « N points non résolus » et la confirmation est tracée au journal d'audit.
 */

import type { PointARegler } from "@/lib/ticpe/controles";

export type DecisionGeneration =
  | { statut: "ok"; pointsNonResolus: number; force: boolean }
  | { statut: "bloque"; bloquants: number; message: string };

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export function nombreBloquants(points: readonly Pick<PointARegler, "gravite">[]): number {
  return points.filter((p) => p.gravite === "bloquant").length;
}

/**
 * `confirme` : nombre de points bloquants que la personne a confirmé passer
 * outre. Il doit être égal au nombre actuel : si la situation a changé entre
 * l'affichage et la demande, on redemande.
 */
export function evaluerGeneration(points: readonly Pick<PointARegler, "gravite">[], confirme?: number | null): DecisionGeneration {
  const n = nombreBloquants(points);
  if (n === 0) return { statut: "ok", pointsNonResolus: 0, force: false };
  if (confirme === n) return { statut: "ok", pointsNonResolus: n, force: true };
  const base = `${pluriel(n, "point")} bloquant${n > 1 ? "s" : ""} à régler avant de générer ce document (voir les contrôles).`;
  return {
    statut: "bloque",
    bloquants: n,
    message: confirme ? `${base} La situation a changé depuis votre demande : confirmez de nouveau.` : base,
  };
}

/** Mention imprimée sur un document généré malgré des points bloquants. */
export function mentionPointsNonResolus(n: number): string {
  if (n <= 0) return "";
  return `ATTENTION : ${pluriel(n, "point")} non résolu${n > 1 ? "s" : ""} au moment de la génération. Document provisoire, à ne pas déclarer en l'état.`;
}

/** Avertissement d'un document : mention éventuelle puis texte habituel. */
export function avertissementDocument(base: string, pointsNonResolus: number): string {
  const mention = mentionPointsNonResolus(pointsNonResolus);
  return mention ? `${mention} ${base}` : base;
}
