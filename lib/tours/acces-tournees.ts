import type { UserRole } from "@/lib/types/domain";

/**
 * Qui voit quoi sur « Modèles de tournées & villages ».
 *
 * - Chefs d'équipe (manager) et direction : toutes les
 *   tournées, la carte, les incohérences, et la modification des fiches.
 * - Tous les autres rôles (chauffeurs en tête) : une liste en lecture
 *   seule des seules tournées sur lesquelles ils sont planifiés (d'hier à
 *   dans une semaine). Ni carte, ni modification, ni villages des
 *   tournées des collègues.
 */
export const GESTION_TOURNEES: UserRole[] = ["manager", "exploitation", "direction"];

export function peutGererTournees(role: UserRole): boolean {
  return GESTION_TOURNEES.includes(role);
}

/** La carte et la liste des incohérences : réservées à la gestion. */
export const peutVoirCarteTournees = peutGererTournees;

export function tourneesVisibles<R extends { serviceId: string | null; tourNumber: string }>(
  routes: R[],
  opts: { role: UserRole; plannedTourNumbers: Iterable<string> },
): R[] {
  if (peutGererTournees(opts.role)) return routes;
  const planned = new Set(opts.plannedTourNumbers);
  return routes.filter((r) => planned.has(r.tourNumber));
}
