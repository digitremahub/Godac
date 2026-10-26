import { peutAttribuerRole } from "@/lib/roles/perimetre";

/**
 * Rôles demandés dans un import en masse que l'acteur n'a pas le droit
 * d'attribuer (direction : tous ; exploitation : chauffeur et manager ;
 * les autres rôles : aucun). Liste vide : l'import peut continuer.
 */
export function rolesImportRefuses(acteur: string, invites: readonly { role: string }[]): string[] {
  return [...new Set(invites.map((i) => i.role).filter((role) => !peutAttribuerRole(acteur, role)))];
}
