/**
 * Un taux horaire saisi à la main dérive vite (augmentation, avenant,
 * changement d'heures contractuelles...) — la direction lit le contrat
 * une fois (salaire mensuel brut/net + heures contractuelles, voir
 * /payroll) et le taux horaire s'en déduit à chaque calcul, plutôt que
 * d'être une valeur figée qu'on oublie de remettre à jour.
 *
 * mensualisation standard française : heures contractuelles/mois =
 * (heures hebdo × 52) / 12 — 151.67h pour un 35h, mais le secteur
 * transport routier applique souvent des heures d'équivalence
 * différentes selon la convention collective ; d'où un champ éditable
 * plutôt qu'une constante.
 */

export interface ContractTerms {
  monthlyGrossSalary: number | null;
  monthlyNetSalary: number | null;
  contractualMonthlyHours: number | null;
}

export interface HourlyRates {
  grossPerHour: number | null;
  netPerHour: number | null;
}

/**
 * Le brut vient toujours du contrat ; le net vient du bulletin de paie
 * et n'y figure pas forcément (comme dans un contrat type convention
 * transport routier, qui ne donne que le taux horaire brut). Calcule
 * donc chaque taux indépendamment — le brut seul reste exploitable
 * même sans le net. Seules les heures contractuelles manquantes ou
 * nulles empêchent tout calcul (division par zéro).
 */
export function computeHourlyRates(contract: ContractTerms): HourlyRates | null {
  if (contract.contractualMonthlyHours === null || contract.contractualMonthlyHours <= 0) {
    return null;
  }
  return {
    grossPerHour: contract.monthlyGrossSalary !== null ? contract.monthlyGrossSalary / contract.contractualMonthlyHours : null,
    netPerHour: contract.monthlyNetSalary !== null ? contract.monthlyNetSalary / contract.contractualMonthlyHours : null,
  };
}

/**
 * Estimation linéaire (heures travaillées × taux horaire) — ne modélise
 * ni les heures supplémentaires majorées, ni les primes, ni les
 * cotisations variables : un ordre de grandeur pour la direction, pas
 * un bulletin de paie. brut/net restent chacun null si leur taux
 * horaire l'est.
 */
export function estimateSalary(workedHours: number, rates: HourlyRates | null): { gross: number | null; net: number | null } | null {
  if (!rates) return null;
  return {
    gross: rates.grossPerHour !== null ? workedHours * rates.grossPerHour : null,
    net: rates.netPerHour !== null ? workedHours * rates.netPerHour : null,
  };
}

/** 52×5/12 — average working days per month for a 5-day week. */
const AVERAGE_WORKING_DAYS_PER_MONTH = 21.67;

/**
 * Hours "as if worked" a single paid-leave weekday is worth, for the
 * chauffeur's own running month-to-date estimate (see
 * app/(dashboard)/tours/history) — congé or maladie both count the
 * same way here, since leave_requests has no type field to tell them
 * apart. Not a real maintien-de-salaire/indemnités-journalières
 * computation (those depend on seniority thresholds and whether CPAM
 * or the employer is paying) — a simple, clearly-labelled
 * approximation for driver-facing reassurance, not a payslip.
 */
export function leaveDayHoursEquivalent(contractualMonthlyHours: number): number {
  return contractualMonthlyHours / AVERAGE_WORKING_DAYS_PER_MONTH;
}

/** Counts Mon-Fri days in [start, end], both inclusive. */
export function countWeekdays(start: Date, end: Date): number {
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}
