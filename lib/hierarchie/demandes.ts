import type { UserRole } from "@/lib/types/domain";

/**
 * Hiérarchie des demandes et des décisions. Fichier pur (aucune
 * dépendance serveur), partagé par les routes, les écrans et les tests.
 * La base applique la même règle en défense en profondeur (migration
 * 20261101000001_hierarchie_demandes.sql : rang_role, est_direction_unique).
 *
 *   chauffeur (0) < manager (1) < exploitation (2) < direction (3)
 *
 * 1. Personne ne décide (ni ne résout) sa propre demande.
 * 2. Le décideur a un rang strictement supérieur à celui du demandeur.
 *    Exception : la direction décide pour une autre personne de la
 *    direction. Une direction seule dans l'organisation peut décider de
 *    sa propre demande (« auto-validée (direction unique) », tracée).
 * 3. Un manager reste limité aux services de ses chauffeurs.
 * 4. Les notifications montent d'un niveau (jamais à soi-même ni à un
 *    pair) et escaladent si ce niveau est vide.
 *
 * Le comptable n'est pas dans la chaîne : il garde ses droits sur la paie
 * (option `paie`) mais ne décide pas des demandes opérationnelles. Quand
 * il est lui-même demandeur, seule la direction décide (rang 2, comme un
 * demandeur « au niveau exploitation »). Le drapeau « conduit » d'un
 * manager ou d'une exploitation ne change pas son rang.
 */

export const RANGS: Readonly<Record<string, number>> = {
  chauffeur: 0,
  manager: 1,
  // Ancien rôle (plus attribuable) : manager qui conduit.
  manager_chauffeur: 1,
  exploitation: 2,
  // Hors chaîne : traité comme un demandeur de niveau exploitation (seule la direction décide).
  comptable: 2,
  direction: 3,
};

/** Rang d'un rôle dans la chaîne (rôle inconnu : 0, comme un chauffeur). */
export function rang(role: UserRole | string | null | undefined): number {
  return RANGS[role ?? ""] ?? 0;
}

/** Dans la chaîne chauffeur → manager → exploitation → direction ? (le comptable n'y est pas) */
export function estDansLaChaine(role: UserRole | string | null | undefined): boolean {
  return role === "chauffeur" || role === "manager" || role === "manager_chauffeur" || role === "exploitation" || role === "direction";
}

/** Rôle normalisé (l'ancien manager_chauffeur devient manager). */
function normaliser(role: UserRole | string): UserRole {
  return (role === "manager_chauffeur" ? "manager" : role) as UserRole;
}

/** Niveau qui décide en premier pour un demandeur de ce rôle (la direction : une autre personne de la direction). */
export function niveauSuperieur(role: UserRole | string): UserRole {
  switch (normaliser(role)) {
    case "chauffeur":
      return "manager";
    case "manager":
      return "exploitation";
    default:
      return "direction";
  }
}

export interface PersonneHierarchie {
  id: string;
  role: UserRole | string;
  /** Services de la personne (user_services). Absent : non vérifié. */
  serviceIds?: readonly string[] | null;
}

export interface UtilisateurOrganisation extends PersonneHierarchie {
  /** false : compte désactivé, jamais destinataire. */
  active?: boolean | null;
}

export type VerdictDecision = { ok: true; autoValidee?: boolean } | { ok: false; raison: string };

/** Qui peut traiter la demande d'un rôle donné, en toutes lettres. */
export function libelleDecideurs(roleDemandeur: UserRole | string): string {
  switch (normaliser(roleDemandeur)) {
    case "chauffeur":
      return "votre manager, l'exploitation ou la direction";
    case "manager":
      return "l'exploitation ou la direction";
    case "exploitation":
    case "comptable":
      return "la direction";
    default:
      return "une autre personne de la direction";
  }
}

export const MESSAGE_PROPRE_DEMANDE = "Vous ne pouvez pas décider de votre propre demande : elle doit être traitée par l'exploitation ou la direction";

function messagePropreDemande(roleDemandeur: UserRole | string): string {
  const role = normaliser(roleDemandeur);
  // Texte imposé pour un manager ; adapté aux autres niveaux.
  if (role === "manager") return `${MESSAGE_PROPRE_DEMANDE}.`;
  return `Vous ne pouvez pas décider de votre propre demande : elle doit être traitée par ${libelleDecideurs(role)}.`;
}

/**
 * Le décideur peut-il décider (ou résoudre) la demande de ce demandeur ?
 * `directionCount` : nombre de comptes direction actifs de l'organisation
 * (1 : une direction seule peut décider de sa propre demande).
 * `paie` : décision de paie, que le comptable garde (jamais pour lui-même).
 */
export function peutDecider(p: { decideur: PersonneHierarchie; demandeur: PersonneHierarchie; directionCount: number; paie?: boolean }): VerdictDecision {
  const { decideur, demandeur, directionCount } = p;
  const roleDecideur = normaliser(decideur.role);
  const roleDemandeur = normaliser(demandeur.role);

  // 1. Jamais sa propre demande — sauf une direction seule (trace d'audit).
  if (decideur.id === demandeur.id) {
    if (roleDecideur === "direction" && directionCount <= 1) return { ok: true, autoValidee: true };
    return { ok: false, raison: messagePropreDemande(roleDemandeur) };
  }

  // Le comptable ne décide que sur la paie.
  if (roleDecideur === "comptable") {
    if (p.paie) return { ok: true };
    return { ok: false, raison: "Le comptable ne décide pas des demandes opérationnelles." };
  }
  if (!estDansLaChaine(roleDecideur)) return { ok: false, raison: "Votre rôle ne permet pas de décider des demandes." };

  // 2. Rang strictement supérieur ; la direction décide pour une autre personne de la direction.
  const memeNiveauDirection = roleDecideur === "direction" && roleDemandeur === "direction";
  if (!memeNiveauDirection && rang(roleDecideur) <= rang(roleDemandeur)) {
    return { ok: false, raison: `Cette demande doit être traitée par ${libelleDecideurs(roleDemandeur)}.` };
  }

  // 3. Un manager décide pour les chauffeurs de ses services (demandeur sans service : tout manager).
  if (roleDecideur === "manager" && decideur.serviceIds && demandeur.serviceIds && demandeur.serviceIds.length > 0) {
    const miens = new Set(decideur.serviceIds);
    if (!demandeur.serviceIds.some((s) => miens.has(s))) return { ok: false, raison: "Cette personne n'est pas dans vos services." };
  }
  return { ok: true };
}

/** Texte de trace quand une direction seule décide de sa propre demande. */
export const TRACE_AUTO_VALIDEE = "auto-validée (direction unique)";

// ── Notifications ───────────────────────────────────────────────────

export interface DestinatairesNotification {
  /** Personnes à prévenir (jamais le demandeur, jamais un compte désactivé). */
  destinataires: UtilisateurOrganisation[];
  /** Niveau effectivement atteint. */
  niveau: UserRole | null;
  /** true : le niveau normal était vide, la demande est montée plus haut. */
  escalade: boolean;
  /** Rôles distincts des destinataires. */
  roles: UserRole[];
}

const actifs = (liste: readonly UtilisateurOrganisation[], demandeurId: string) => liste.filter((u) => u.id !== demandeurId && u.active !== false);

/**
 * À qui adresser la demande de X : le niveau juste au-dessus, jamais
 * lui-même ni un pair.
 *  - chauffeur : manager de son service (sans service : tout manager) ;
 *  - manager : exploitation et direction ;
 *  - exploitation, comptable : direction ;
 *  - direction : les autres membres de la direction.
 * Niveau vide : escalade au suivant (manager → exploitation → direction).
 */
export function destinatairesNotification(demandeur: PersonneHierarchie, utilisateurs: readonly UtilisateurOrganisation[]): DestinatairesNotification {
  const autres = actifs(utilisateurs, demandeur.id);
  const parRole = (r: string) => autres.filter((u) => normaliser(u.role) === r);
  const role = normaliser(demandeur.role);

  const niveaux: { role: UserRole; personnes: UtilisateurOrganisation[] }[] = [];
  if (role === "chauffeur") {
    const siens = new Set(demandeur.serviceIds ?? []);
    const managers = parRole("manager");
    niveaux.push({ role: "manager", personnes: siens.size > 0 ? managers.filter((m) => (m.serviceIds ?? []).some((s) => siens.has(s))) : managers });
    niveaux.push({ role: "exploitation", personnes: parRole("exploitation") });
    niveaux.push({ role: "direction", personnes: parRole("direction") });
  } else if (role === "manager") {
    // Les deux niveaux ensemble ; la direction seule s'il n'y a pas d'exploitation.
    niveaux.push({ role: "exploitation", personnes: [...parRole("exploitation"), ...parRole("direction")] });
  } else {
    niveaux.push({ role: "direction", personnes: parRole("direction") });
  }

  const index = niveaux.findIndex((n) => n.personnes.length > 0);
  if (index === -1) return { destinataires: [], niveau: null, escalade: false, roles: [] };
  const retenu = niveaux[index]!;
  const roles = [...new Set(retenu.personnes.map((u) => normaliser(u.role)))];
  return { destinataires: retenu.personnes, niveau: retenu.role, escalade: index > 0, roles };
}

// ── Libellés ────────────────────────────────────────────────────────

export interface EffectifsRoles {
  manager?: number;
  exploitation?: number;
  direction?: number;
}

const LIBELLE_NIVEAU: Record<string, string> = {
  manager: "du manager",
  exploitation: "de l'exploitation",
  direction: "de la direction",
};

/**
 * « En attente de … » pour la personne qui a fait la demande. `effectifs`
 * (facultatif) : nombre de comptes par rôle, pour refléter l'escalade
 * quand un niveau est vide (sans exploitation : « de la direction »).
 */
export function libelleEnAttente(roleDemandeur: UserRole | string, effectifs?: EffectifsRoles): string {
  const role = normaliser(roleDemandeur);
  if (role === "direction") {
    return effectifs && (effectifs.direction ?? 0) <= 1 ? "En attente de votre validation (direction unique)" : "En attente d'une autre personne de la direction";
  }
  let niveau: string = niveauSuperieur(role);
  if (effectifs) {
    if (niveau === "manager" && (effectifs.manager ?? 0) === 0) niveau = "exploitation";
    if (niveau === "exploitation" && (effectifs.exploitation ?? 0) === 0) niveau = "direction";
  }
  return `En attente ${LIBELLE_NIVEAU[niveau]}`;
}

/** Mention des écrans de décision quand l'utilisateur ne peut pas décider (lecture seule). */
export function libelleADecider(roleDemandeur: UserRole | string): string {
  switch (normaliser(roleDemandeur)) {
    case "chauffeur":
      return "À décider par le manager, l'exploitation ou la direction";
    case "manager":
      return "À décider par l'exploitation ou la direction";
    case "exploitation":
    case "comptable":
      return "À décider par la direction";
    default:
      return "À décider par une autre personne de la direction";
  }
}

/**
 * Pour un écran : peut-on afficher Valider / Refuser, sinon quelle mention
 * montrer. `moi` est l'utilisateur connecté, `demandeur` l'auteur de la demande.
 */
export function droitsDecision(p: { moi: PersonneHierarchie; demandeur: PersonneHierarchie; directionCount: number; paie?: boolean }): { peutDecider: boolean; autoValidee: boolean; mention: string | null } {
  const v = peutDecider({ decideur: p.moi, demandeur: p.demandeur, directionCount: p.directionCount, paie: p.paie });
  if (v.ok) return { peutDecider: true, autoValidee: Boolean(v.autoValidee), mention: null };
  return { peutDecider: false, autoValidee: false, mention: p.moi.id === p.demandeur.id ? `Votre demande — ${libelleADecider(p.demandeur.role).toLowerCase()}` : libelleADecider(p.demandeur.role) };
}
