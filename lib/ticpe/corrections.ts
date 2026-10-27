/**
 * Corrections de points bloquants TICPE sur un plein (justificatif, zone et
 * pays, doublon) : qui peut les faire, et quels points se corrigent en lot.
 * Pur, testé dans lib/ticpe/__tests__/corrections.test.ts.
 *
 * Le comptable prépare la déclaration : il corrige ces points sans pour autant
 * obtenir la validation hiérarchique (les écarts carburant, l'approbation des
 * pleins et des demandes restent à l'encadrement). Aucune de ces actions ne
 * touche aux litres ni aux montants.
 */
import type { CodeControle, PointARegler } from "@/lib/ticpe/controles";

/** Rôles autorisés sur les routes de correction d'un plein (justificatif, zone, doublon). */
export const ROLES_CORRECTION_PLEIN = ["manager", "exploitation", "direction", "comptable"] as const;
/** Le comptable n'a pas la lecture RLS-écriture des pleins : ses corrections passent par le client service, après garde. */
export const ROLES_SANS_ECRITURE_RLS = ["comptable"] as const;

export type ActionLot = "justificatif" | "zone" | "doublon";
export const ACTIONS_LOT: readonly ActionLot[] = ["justificatif", "zone", "doublon"];

/** Plafond de pleins par action groupée (une requête de vérification par plein). */
export const LOT_MAX = 50;

/** Points bloquants ou à vérifier qui se corrigent par chaque action groupée. */
export const CODES_PAR_ACTION: Readonly<Record<ActionLot, readonly CodeControle[]>> = {
  justificatif: ["sans_justificatif"],
  zone: ["zone_a_verifier", "hors_france"],
  doublon: ["doublon"],
};

export const LIBELLES_ACTION_LOT: Readonly<Record<ActionLot, string>> = {
  justificatif: "Joindre un justificatif (relevé ou facture)",
  zone: "Confirmer la zone et le pays",
  doublon: "Confirmer deux pleins distincts",
};

/** Action groupée qui corrige ce point, ou null si le point se corrige ailleurs (véhicule, réglages…). */
export function actionPourPoint(point: Pick<PointARegler, "code" | "objet">): ActionLot | null {
  if (point.objet.type !== "plein" || !point.objet.id) return null;
  for (const action of ACTIONS_LOT) if (CODES_PAR_ACTION[action].includes(point.code)) return action;
  return null;
}

/** Points d'un plein qui se corrigent en lot, regroupés par action (identifiants de pleins sans doublon). */
export function pointsCorrigeablesEnLot(points: readonly PointARegler[]): Record<ActionLot, { pleinId: string; cle: string }[]> {
  const groupes: Record<ActionLot, { pleinId: string; cle: string }[]> = { justificatif: [], zone: [], doublon: [] };
  const vus = new Set<string>();
  for (const p of points) {
    const action = actionPourPoint(p);
    if (!action) continue;
    const marque = `${action}:${p.objet.id}`;
    if (vus.has(marque)) continue;
    vus.add(marque);
    groupes[action].push({ pleinId: p.objet.id!, cle: p.cle });
  }
  return groupes;
}

/** Identifiants valides pour une action groupée : uniques, au plus LOT_MAX. */
export function normaliserLot(ids: readonly string[]): string[] {
  return [...new Set(ids)].slice(0, LOT_MAX);
}
