/**
 * Totaux carburant des tableaux de bord et du reporting. Seuls les
 * pleins « de confiance » comptent (saisis à la main ou ticket OCR
 * validé : un ticket en attente peut encore être faux), et les litres
 * de gazole sont séparés de l'AdBlue — additionner les deux faussait
 * litres et L/100 km. Le coût, lui, couvre les deux produits.
 */

export const TRUSTED_FUEL_STATUSES = ["manual", "validated"] as const;

export interface FuelTotalsRow {
  liters: number | string | null;
  total_amount: number | string | null;
  status?: string | null;
  product?: string | null;
}

export interface FuelTotals {
  gazoleLiters: number;
  adblueLiters: number;
  /** Gazole + AdBlue, en euros. */
  cost: number;
  gazoleCost: number;
  count: number;
}

export function isTrustedFuelRow(row: { status?: string | null }): boolean {
  // Sans statut sélectionné : la requête a déjà filtré.
  return row.status == null || (TRUSTED_FUEL_STATUSES as readonly string[]).includes(row.status);
}

export function summarizeFuelRows(rows: FuelTotalsRow[]): FuelTotals {
  const totals: FuelTotals = { gazoleLiters: 0, adblueLiters: 0, cost: 0, gazoleCost: 0, count: 0 };
  for (const r of rows) {
    if (!isTrustedFuelRow(r)) continue;
    const liters = Number(r.liters ?? 0) || 0;
    const amount = Number(r.total_amount ?? 0) || 0;
    totals.count += 1;
    totals.cost += amount;
    if (r.product === "adblue") {
      totals.adblueLiters += liters;
    } else {
      totals.gazoleLiters += liters;
      totals.gazoleCost += amount;
    }
  }
  return totals;
}
