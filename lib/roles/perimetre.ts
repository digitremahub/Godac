import type { UserRole } from "@/lib/types/domain";

/**
 * Périmètre des rôles d'encadrement. Fichier pur (aucune dépendance
 * serveur), partagé par les gardes, les pages et les tests.
 *
 *   manager       → ses services (user_services) ;
 *   exploitation  → toute l'organisation, sans limite de services : tout ce
 *                   que voit un manager, plus la gestion des comptes
 *                   chauffeur et manager ; jamais la paie, la facturation,
 *                   les réglages de l'organisation ni le journal d'audit ;
 *   direction     → toute l'organisation, sans restriction.
 *
 * Côté base : is_manager_like() inclut exploitation, current_user_service_ids()
 * renvoie tous les services de l'organisation pour exploitation, et
 * est_encadrement_org() = direction ou exploitation (migration 20261027000002).
 */

/** Encadrement opérationnel : manager, exploitation, direction. */
export const ROLES_ENCADREMENT: readonly UserRole[] = ["manager", "exploitation", "direction"];

/** Encadrement à l'échelle de l'organisation : direction, exploitation. */
export const ROLES_ENCADREMENT_ORG: readonly UserRole[] = ["exploitation", "direction"];

export function estEncadrement(role: UserRole | string | null | undefined): boolean {
  return (ROLES_ENCADREMENT as readonly string[]).includes(role ?? "");
}

export function estExploitation(role: UserRole | string | null | undefined): boolean {
  return role === "exploitation";
}

/**
 * Voit et gère les données opérationnelles de toute l'organisation, sans
 * filtre par services (planning, tournées, carburant, flotte, congés…).
 * Ne donne JAMAIS accès à la paie, à la facturation, aux réglages ni à
 * l'audit : ceux-là restent testés par `role === "direction"`.
 */
export function voitToutLOrganisation(role: UserRole | string | null | undefined): boolean {
  return (ROLES_ENCADREMENT_ORG as readonly string[]).includes(role ?? "");
}

/**
 * Services dans lesquels filtrer une requête : `null` = aucun filtre
 * (toute l'organisation), sinon les services de la personne (manager).
 * Un rôle hors encadrement n'a aucun service d'encadrement.
 */
export function servicesDuPerimetre(role: UserRole | string, mesServices: readonly string[]): string[] | null {
  if (voitToutLOrganisation(role)) return null;
  if (role === "manager") return [...mesServices];
  return [];
}

/** Un élément rattaché à `serviceId` est-il dans le périmètre ? */
export function dansLePerimetre(role: UserRole | string, mesServices: readonly string[], serviceId: string | null | undefined): boolean {
  const services = servicesDuPerimetre(role, mesServices);
  if (services === null) return true;
  return Boolean(serviceId) && services.includes(serviceId!);
}

// ── Gestion des comptes ────────────────────────────────────────────

/** Rôles que l'exploitation peut créer, modifier, désactiver. */
export const ROLES_GERES_PAR_EXPLOITATION: readonly UserRole[] = ["chauffeur", "manager"];

/** Rôles qu'une personne peut attribuer (création ou changement de rôle). */
export function rolesAttribuables(acteur: UserRole | string): UserRole[] {
  if (acteur === "direction") return ["chauffeur", "manager", "exploitation", "comptable", "direction"];
  if (acteur === "exploitation") return [...ROLES_GERES_PAR_EXPLOITATION];
  return [];
}

/** Peut attribuer ce rôle (à la création ou par changement de rôle). */
export function peutAttribuerRole(acteur: UserRole | string, role: UserRole | string): boolean {
  return (rolesAttribuables(acteur) as string[]).includes(role);
}

/**
 * Peut gérer le compte d'une personne ayant le rôle `cible` (désactiver,
 * services, « conduit aussi », réinitialisation d'accès, changement de
 * rôle). La direction gère tout le monde ; l'exploitation seulement les
 * chauffeurs et les managers ; personne d'autre.
 */
export function peutGererCompte(acteur: UserRole | string, cible: UserRole | string): boolean {
  if (acteur === "direction") return true;
  if (acteur === "exploitation") return (ROLES_GERES_PAR_EXPLOITATION as readonly string[]).includes(cible);
  return false;
}

/**
 * Champs du compte que l'exploitation peut modifier (PATCH
 * /api/admin/users/[id]) : identité, contact, rôle (chauffeur ↔ manager),
 * conduite, activation, services, réinitialisation du PIN. Salaire,
 * contrat et dossier RH restent à la direction.
 */
export const CHAMPS_COMPTE_EXPLOITATION: readonly string[] = [
  "role",
  "role_title",
  "can_drive",
  "active",
  "full_name",
  "email",
  "phone",
  "address",
  "contact_email",
  "service_id",
  "services",
  "reset_pin",
];

export type RefusModificationCompte = { ok: true } | { ok: false; status: 403; error: string };

/** Contrôle pur d'une modification de compte par l'exploitation. */
export function verifierModificationParExploitation(cibleRole: UserRole | string, champs: readonly string[], nouveauRole?: UserRole | string): RefusModificationCompte {
  if (!peutGererCompte("exploitation", cibleRole)) {
    return { ok: false, status: 403, error: "L'exploitation ne gère que les comptes chauffeur et manager." };
  }
  const interdits = champs.filter((c) => !CHAMPS_COMPTE_EXPLOITATION.includes(c));
  if (interdits.length > 0) {
    return { ok: false, status: 403, error: "Salaire, contrat et dossier RH : réservés à la direction." };
  }
  if (nouveauRole !== undefined && !peutAttribuerRole("exploitation", nouveauRole)) {
    return { ok: false, status: 403, error: "Seule la direction peut attribuer les rôles direction, comptable et exploitation." };
  }
  return { ok: true };
}

// ── Alertes ─────────────────────────────────────────────────────────

/**
 * Rôles destinataires effectifs d'une alerte (e-mail, push) : l'exploitation
 * reçoit tout ce qui est destiné à l'encadrement (manager). Les alertes
 * réservées à la direction (paie, facturation, sécurité) ne lui parviennent
 * pas.
 */
export function rolesDestinatairesEffectifs(recipientRoles: readonly string[]): string[] {
  const roles = new Set(recipientRoles);
  if (roles.has("manager") || roles.has("manager_chauffeur")) roles.add("exploitation");
  return [...roles];
}
