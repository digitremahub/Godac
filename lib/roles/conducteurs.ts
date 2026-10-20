import type { UserRole } from "@/lib/types/domain";

/**
 * « Conducteur » : chauffeur, ou manager qui conduit aussi
 * (users.can_drive, migration 20261021000002). Remplace l'ancien rôle
 * manager_chauffeur, retiré à la demande du client. Fichier pur.
 */
export function estConducteur(role: UserRole | string, canDrive: boolean | null | undefined): boolean {
  return role === "chauffeur" || (role === "manager" && Boolean(canDrive));
}

/**
 * Filtre PostgREST des conducteurs, pour `.or(FILTRE_CONDUCTEURS)` à la
 * place de l'ancien filtre sur les rôles chauffeur et manager_chauffeur.
 */
export const FILTRE_CONDUCTEURS = "role.eq.chauffeur,and(role.eq.manager,can_drive.is.true)";
