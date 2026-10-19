/**
 * Clé d'un créneau de planning (service, numéro de tournée, départ).
 * `start_at` relu en base vaut « …+00:00 » alors qu'une date générée vaut
 * « ….000Z » : on compare l'instant (Date.parse), jamais la chaîne.
 */
export function cleCreneau(serviceId: string, tourNumber: string, startAt: string): string {
  return `${serviceId}|${tourNumber}|${Date.parse(startAt)}`;
}
