import type { UserRole } from "@/lib/types/domain";

/**
 * Qui voit quoi sur « Modèles de tournées & villages ».
 *
 * - Chefs d'équipe (manager) et direction : toutes les
 *   tournées, la carte, les incohérences, et la modification des fiches.
 * - Tous les autres rôles (chauffeurs en tête) : une liste en lecture
 *   seule des tournées de leurs services (et des tournées « tous
 *   services »), plus celles sur lesquelles ils sont planifiés. Ni carte,
 *   ni modification, ni tournées d'autres services.
 */
export const GESTION_TOURNEES: UserRole[] = ["manager", "exploitation", "direction"];

export function peutGererTournees(role: UserRole): boolean {
  return GESTION_TOURNEES.includes(role);
}

/** La carte et la liste des incohérences : réservées à la gestion. */
export const peutVoirCarteTournees = peutGererTournees;

export function tourneesVisibles<R extends { serviceId: string | null; tourNumber: string }>(
  routes: R[],
  opts: { role: UserRole; myServiceIds: Iterable<string>; plannedTourNumbers: Iterable<string> },
): R[] {
  if (peutGererTournees(opts.role)) return routes;
  const services = new Set(opts.myServiceIds);
  const planned = new Set(opts.plannedTourNumbers);
  return routes.filter((r) => planned.has(r.tourNumber) || !r.serviceId || services.has(r.serviceId));
}
