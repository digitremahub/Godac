// Limites de formule (décision client Q8) : avertissement à 100 %,
// blocage au-delà de 110 % du nombre de véhicules inclus. Fonctions pures,
// testées dans lib/acces/__tests__/limites.test.ts.

/** Tolérance au-delà de la limite avant blocage (110 %). */
export const TOLERANCE_BLOCAGE = 1.1;

export type NiveauLimite = "ok" | "proche" | "avertissement" | "bloque";

export interface EtatLimite {
  utilise: number;
  /** null = illimité. */
  inclus: number | null;
  /** Plafond dur : au-delà, la création est refusée. */
  plafond: number | null;
  niveau: NiveauLimite;
}

export function plafondBlocage(inclus: number): number {
  return Math.floor(inclus * TOLERANCE_BLOCAGE + 1e-9);
}

/** État pour l'affichage (jauge). */
export function etatLimite(utilise: number, inclus: number | null | undefined): EtatLimite {
  if (inclus === null || inclus === undefined || inclus <= 0) return { utilise, inclus: null, plafond: null, niveau: "ok" };
  const plafond = plafondBlocage(inclus);
  const niveau: NiveauLimite = utilise >= plafond ? "bloque" : utilise >= inclus ? "avertissement" : utilise >= inclus * 0.8 ? "proche" : "ok";
  return { utilise, inclus, plafond, niveau };
}

export type DecisionAjout =
  | { ok: true; avertissement: string | null }
  | { ok: false; message: string };

/**
 * Peut-on ajouter `ajout` éléments ? Refus si le total dépasse 110 % de
 * l'inclus ; avertissement dès que le total atteint ou dépasse l'inclus.
 */
export function deciderAjout(params: { utilise: number; inclus: number | null | undefined; ajout?: number; formule?: string; unite?: string }): DecisionAjout {
  const { utilise, inclus, ajout = 1, formule, unite = "véhicules" } = params;
  if (inclus === null || inclus === undefined || inclus <= 0) return { ok: true, avertissement: null };
  const total = utilise + ajout;
  const plafond = plafondBlocage(inclus);
  const nomFormule = formule ? `Votre formule ${formule}` : "Votre formule";
  if (total > plafond) {
    return {
      ok: false,
      message: `${nomFormule} inclut ${inclus} ${unite} (${utilise} utilisés). Au-delà de ${plafond}, passez à la formule supérieure.`,
    };
  }
  if (total >= inclus) {
    return { ok: true, avertissement: `${nomFormule} inclut ${inclus} ${unite} : vous en aurez ${total}. Pensez à passer à la formule supérieure.` };
  }
  return { ok: true, avertissement: null };
}
