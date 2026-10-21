import type { UserRole } from "@/lib/types/domain";

/** Rôles d'encadrement qui peuvent aussi conduire (users.can_drive). */
export const ROLES_PEUVENT_CONDUIRE: readonly UserRole[] = ["manager", "exploitation"];

/**
 * « Conducteur » : chauffeur, ou manager / exploitation qui conduit aussi
 * (users.can_drive, migrations 20261021000002 et 20261027000001).
 * Remplace l'ancien rôle manager_chauffeur, retiré à la demande du client.
 * Fichier pur.
 */
export function estConducteur(role: UserRole | string, canDrive: boolean | null | undefined): boolean {
  return role === "chauffeur" || ((ROLES_PEUVENT_CONDUIRE as readonly string[]).includes(role) && Boolean(canDrive));
}

/**
 * Filtre PostgREST des conducteurs, pour `.or(FILTRE_CONDUCTEURS)` à la
 * place de l'ancien filtre sur les rôles chauffeur et manager_chauffeur :
 * chauffeur, ou can_drive pour un rôle qui peut conduire (manager,
 * exploitation).
 *
 * Écrit par exclusion (`role.not.in.(…)`) pour ne jamais citer la valeur
 * d'enum 'exploitation' : le filtre reste valide tant que la migration
 * 20261027000001 n'est pas appliquée (PostgREST refuserait une valeur
 * d'enum inconnue). Équivalent à estConducteur() pour les rôles connus.
 */
export const FILTRE_CONDUCTEURS = "role.eq.chauffeur,and(can_drive.is.true,role.not.in.(comptable,direction))";
