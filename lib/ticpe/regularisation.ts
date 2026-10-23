/**
 * Pleins et véhicules modifiés après la déclaration d'une période — pur, testé.
 * GODAC ne verrouille pas les périodes déclarées : il compare le montant
 * calculé aujourd'hui au montant déclaré (« à régulariser »), prévient avant
 * la modification d'un plein d'une période déclarée et trace avant / après.
 */

import type { Declaration } from "@/lib/ticpe/echeances";

/** Seuil sous lequel l'écart n'est qu'un arrondi (1 centime). */
export const SEUIL_ECART_EUROS = 0.01;

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface EcartDeclaration {
  /** Montant calculé aujourd'hui − montant déclaré (négatif : on a déclaré plus que le calcul actuel). */
  ecart: number;
  aRegulariser: boolean;
  /** « calculé ≠ déclaré (écart X €) — à régulariser », ou null s'il n'y a pas d'écart. */
  message: string | null;
}

export function ecartAvecDeclaration(montantDeclare: number, montantCalcule: number, seuil = SEUIL_ECART_EUROS): EcartDeclaration {
  const ecart = r2(montantCalcule - montantDeclare);
  if (Math.abs(ecart) < seuil) return { ecart: 0, aRegulariser: false, message: null };
  return { ecart, aRegulariser: true, message: `calculé ≠ déclaré (écart ${ecart > 0 ? "+" : "−"}${euros(Math.abs(ecart))}) — à régulariser` };
}

/** Déclaration non annulée qui couvre ce jour (AAAA-MM-JJ), sinon null. */
export function declarationDuJour<D extends Declaration>(jour: string, declarations: readonly D[]): D | null {
  return declarations.find((d) => !d.annulee_le && d.periode_debut <= jour && d.periode_fin >= jour) ?? null;
}

/** Champs d'un plein qui changent le montant TICPE. */
export const CHAMPS_PLEIN_TICPE = ["liters", "occurred_at", "vehicle_id", "product", "tank_id", "ticpe_zone", "pays_achat", "ticpe_doublon_leve_le"] as const;

export function modifieLeMontantTicpe(champs: Record<string, unknown>): boolean {
  return CHAMPS_PLEIN_TICPE.some((c) => champs[c] !== undefined);
}

/** Message affiché avant la modification d'un plein d'une période déclarée. */
export function messagePeriodeDeclaree(d: { periode_libelle?: string | null; periode_cle?: string; declaree_le?: string }): string {
  const nom = d.periode_libelle ?? d.periode_cle ?? "cette période";
  const quand = d.declaree_le ? ` le ${d.declaree_le.split("-").reverse().join("/")}` : "";
  return `Ce plein appartient à une période TICPE déjà déclarée (${nom}, déclarée${quand}). Le modifier change le montant calculé : la déclaration devra être régularisée. La modification sera enregistrée au journal.`;
}

/**
 * Écart « calculé aujourd'hui / déclaré » de chaque déclaration non annulée.
 * `montantCalcule` renvoie null quand la période n'est pas calculée (trop
 * ancienne) : la déclaration est alors ignorée, sans fausse alerte.
 */
export function ecartsDeclarations<D extends Declaration & { id: string; montant: number }>(
  declarations: readonly D[],
  montantCalcule: (d: D) => number | null,
): Map<string, EcartDeclaration> {
  const res = new Map<string, EcartDeclaration>();
  for (const d of declarations) {
    if (d.annulee_le) continue;
    const calcule = montantCalcule(d);
    if (calcule === null) continue;
    res.set(d.id, ecartAvecDeclaration(d.montant, calcule));
  }
  return res;
}
