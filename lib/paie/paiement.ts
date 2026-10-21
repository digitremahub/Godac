import type { ModePaiement, VariablesMois } from "@/lib/paie/types";

/**
 * Date et mode de paiement du salaire, mention obligatoire du bulletin
 * (art. R3243-1 du code du travail). Pur : partagé par l'écran de
 * préparation, l'API de génération et le PDF.
 */

export const MODES_PAIEMENT: Record<ModePaiement, string> = {
  virement: "Virement",
  cheque: "Chèque",
  especes: "Espèces",
};

/** « par virement », « par chèque », « en espèces ». */
const LOCUTION_MODE: Record<ModePaiement, string> = {
  virement: "par virement",
  cheque: "par chèque",
  especes: "en espèces",
};

/** Dernier jour du mois "AAAA-MM" (AAAA-MM-JJ). */
export function dernierJourDuMois(mois: string): string {
  const [y, m] = mois.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Paiement par défaut : dernier jour du mois, par virement. */
export function paiementParDefaut(mois: string): { datePaiement: string; modePaiement: ModePaiement } {
  return { datePaiement: dernierJourDuMois(mois), modePaiement: "virement" };
}

/** Date et mode retenus pour le bulletin : ceux des variables, sinon le défaut du mois. */
export function paiementDuBulletin(mois: string, variables: Pick<VariablesMois, "datePaiement" | "modePaiement">): { datePaiement: string; modePaiement: ModePaiement } {
  const defaut = paiementParDefaut(mois);
  const date = variables.datePaiement && /^\d{4}-\d{2}-\d{2}$/.test(variables.datePaiement) ? variables.datePaiement : defaut.datePaiement;
  return { datePaiement: date, modePaiement: variables.modePaiement ?? defaut.modePaiement };
}

/** « Paiement le 30/09/2026 par virement ». */
export function libellePaiement(datePaiement: string, mode: ModePaiement): string {
  const [y, m, d] = datePaiement.split("-");
  return `Paiement le ${d}/${m}/${y} ${LOCUTION_MODE[mode]}`;
}
