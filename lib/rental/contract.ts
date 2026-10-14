/**
 * Contrat de location : échéance et forfait kilométrique au prorata.
 * Fonctions pures (dates calendaires « AAAA-MM-JJ »), utilisées par la
 * fiche véhicule et le cron quotidien /api/cron/loueurs.
 */

const DAY_MS = 24 * 3600 * 1000;

function parseDay(d: string): number {
  // Minuit UTC : seules les différences en jours comptent.
  return Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
}

/** Jours restants jusqu'à la fin du contrat (négatif si dépassée). */
export function daysUntil(endDate: string, today: string): number {
  return Math.round((parseDay(endDate) - parseDay(today)) / DAY_MS);
}

export const END_ALERT_DAYS = 30;

export function endDateAlertDue(endDate: string | null | undefined, today: string, windowDays = END_ALERT_DAYS): boolean {
  if (!endDate) return false;
  const d = daysUntil(endDate, today);
  return d >= 0 && d <= windowDays;
}

export type KmAllowanceLevel = "ok" | "surveiller" | "proche" | "depasse";

export interface KmAllowanceInput {
  /** Forfait total sur la durée du contrat. */
  allowanceKm: number;
  startDate: string;
  endDate: string;
  startKm: number;
  currentKm: number;
  today: string;
}

export interface KmAllowanceResult {
  drivenKm: number;
  /** Part du contrat écoulée, entre 0 et 1. */
  elapsedRatio: number;
  /** Kilomètres « autorisés » à date au prorata du temps écoulé. */
  prorataKm: number;
  /** Kilométrage projeté en fin de contrat au rythme actuel. */
  projectedKm: number;
  /** Part du forfait déjà consommée. */
  usedRatio: number;
  level: KmAllowanceLevel;
}

/** Seuil « proche » : 90 % du forfait consommés. */
export const KM_NEAR_RATIO = 0.9;
/** En dessous de 10 % du contrat écoulé, la projection n'est pas significative. */
export const KM_MIN_ELAPSED_FOR_PROJECTION = 0.1;

export function evaluateKmAllowance(input: KmAllowanceInput): KmAllowanceResult | null {
  const { allowanceKm, startDate, endDate, startKm, currentKm, today } = input;
  if (!(allowanceKm > 0)) return null;
  const total = parseDay(endDate) - parseDay(startDate);
  if (!(total > 0)) return null;
  const elapsedRatio = Math.min(1, Math.max(0, (parseDay(today) - parseDay(startDate)) / total));
  const drivenKm = Math.max(0, currentKm - startKm);
  const prorataKm = allowanceKm * elapsedRatio;
  const projectedKm = elapsedRatio > 0 ? drivenKm / elapsedRatio : drivenKm;
  const usedRatio = drivenKm / allowanceKm;

  let level: KmAllowanceLevel = "ok";
  if (drivenKm >= allowanceKm) level = "depasse";
  else if (usedRatio >= KM_NEAR_RATIO) level = "proche";
  else if (elapsedRatio >= KM_MIN_ELAPSED_FOR_PROJECTION && projectedKm > allowanceKm) level = "surveiller";

  return {
    drivenKm: Math.round(drivenKm),
    elapsedRatio,
    prorataKm: Math.round(prorataKm),
    projectedKm: Math.round(projectedKm),
    usedRatio,
    level,
  };
}

export const KM_LEVEL_LABELS: Record<KmAllowanceLevel, string> = {
  ok: "Dans le forfait",
  surveiller: "Dépassement prévu au rythme actuel",
  proche: "Forfait presque atteint",
  depasse: "Forfait dépassé",
};

export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString("fr-FR").replace(/[  ]/g, " ")} km`;
}
