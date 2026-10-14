import type { UserRole } from "@/lib/types/domain";

/**
 * Groupes d'équipe du Messenger — règles pures, partagées par les
 * routes API (contrôles avant écriture) et testées dans
 * lib/messenger/__tests__. La synchronisation réelle des membres est
 * faite côté serveur par lib/messenger/synchro-serveur.ts :
 * computeTeamGroupMembers() est la règle unique,
 * utilisée par la synchro et par les routes.
 */

export type GroupMemberRole = "admin" | "member";
export type GroupKind = "team" | "custom";

export interface CandidateUser {
  id: string;
  role: UserRole;
  active: boolean;
  pending_approval?: boolean | null;
  email?: string | null;
  contact_email?: string | null;
}

export interface ServiceTeamInfo {
  id: string;
  team_leader_user_id?: string | null;
  team_leader_email?: string | null;
}

/** Rôles GODAC qui sont responsables d'office dans un groupe (en plus du chef d'équipe). */
const ROLES_RESPONSABLES: UserRole[] = ["manager", "manager_chauffeur", "direction"];

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Un compte actif et validé — un compte désactivé perd immédiatement l'accès aux groupes. */
export function estCompteActif(u: Pick<CandidateUser, "active" | "pending_approval">): boolean {
  return u.active && !u.pending_approval;
}

/**
 * Le chef d'équipe d'un service : le compte GODAC lié explicitement
 * (services.team_leader_user_id) ou, à défaut, le compte dont l'e-mail
 * (de connexion ou de contact) correspond à l'e-mail du chef saisi
 * dans « Organisation > Services ».
 */
export function estChefEquipe(user: CandidateUser, service: ServiceTeamInfo): boolean {
  if (service.team_leader_user_id && service.team_leader_user_id === user.id) return true;
  const email = norm(service.team_leader_email);
  if (!email) return false;
  return norm(user.email) === email || norm(user.contact_email) === email;
}

/**
 * Membres attendus du groupe d'équipe d'un service : utilisateurs
 * actifs rattachés au service (user_services) + le(s) chef(s)
 * d'équipe, même s'ils ne sont pas rattachés. Chef d'équipe,
 * managers et direction rattachés sont responsables (admin).
 */
export function computeTeamGroupMembers(
  service: ServiceTeamInfo,
  serviceUserIds: Iterable<string>,
  orgUsers: CandidateUser[],
): Map<string, GroupMemberRole> {
  const inService = new Set(serviceUserIds);
  const result = new Map<string, GroupMemberRole>();
  for (const u of orgUsers) {
    if (!estCompteActif(u)) continue;
    const chef = estChefEquipe(u, service);
    if (!inService.has(u.id) && !chef) continue;
    result.set(u.id, chef || ROLES_RESPONSABLES.includes(u.role) ? "admin" : "member");
  }
  return result;
}

export interface ExistingMember {
  user_id: string;
  role: GroupMemberRole;
  source: "auto" | "manual";
}

/**
 * Écart entre les membres actuels et attendus. Les membres ajoutés à la
 * main (direction qui a rejoint le groupe) sont conservés tant que
 * leur compte est actif ; les membres automatiques suivent le service.
 */
export function diffTeamGroupMembers(
  current: ExistingMember[],
  desired: Map<string, GroupMemberRole>,
  activeUserIds: Set<string>,
): { toAdd: { user_id: string; role: GroupMemberRole }[]; toUpdate: { user_id: string; role: GroupMemberRole }[]; toRemove: string[] } {
  const toAdd: { user_id: string; role: GroupMemberRole }[] = [];
  const toUpdate: { user_id: string; role: GroupMemberRole }[] = [];
  const toRemove: string[] = [];
  const byId = new Map(current.map((m) => [m.user_id, m]));
  for (const m of current) {
    if (!activeUserIds.has(m.user_id)) toRemove.push(m.user_id);
    else if (m.source === "auto" && !desired.has(m.user_id)) toRemove.push(m.user_id);
  }
  desired.forEach((role, userId) => {
    const existing = byId.get(userId);
    if (!existing) toAdd.push({ user_id: userId, role });
    else if (existing.role !== role || existing.source !== "auto") toUpdate.push({ user_id: userId, role });
  });
  return { toAdd, toUpdate, toRemove };
}

export interface GroupAccess {
  /** Rôle GODAC de l'utilisateur. */
  userRole: UserRole;
  /** Son rôle dans le groupe, null s'il n'en est pas membre. */
  memberRole: GroupMemberRole | null;
  active: boolean;
}

/** Responsable du groupe : admin du groupe, ou direction (qui peut tout lire et rejoindre). */
export function estResponsableGroupe(a: GroupAccess): boolean {
  if (!a.active) return false;
  return a.memberRole === "admin" || a.userRole === "direction";
}

export function peutLireGroupe(a: GroupAccess): boolean {
  if (!a.active) return false;
  return a.memberRole !== null || a.userRole === "direction";
}

/**
 * Écrire dans le groupe : il faut en être membre (la direction le
 * rejoint d'abord) ; en mode « seuls les responsables écrivent », seuls
 * les responsables peuvent poster.
 */
export function peutEcrireGroupe(a: GroupAccess, announcementOnly: boolean): boolean {
  if (!a.active || a.memberRole === null) return false;
  return !announcementOnly || estResponsableGroupe(a);
}

/** Réagir (emoji) : tout membre, même en mode annonces, comme sur WhatsApp. */
export function peutReagir(a: GroupAccess): boolean {
  return a.active && a.memberRole !== null;
}

/** Publier une « Info équipe », épingler/désépingler, changer le mode, gérer les membres. */
export function peutAdministrerGroupe(a: GroupAccess): boolean {
  return estResponsableGroupe(a);
}

/** Supprimer un message : son auteur, ou un responsable du groupe (modération). */
export function peutSupprimerMessage(a: GroupAccess, senderId: string, userId: string): boolean {
  if (!a.active) return false;
  return senderId === userId || estResponsableGroupe(a);
}

/**
 * « Créer un groupe » : managers, direction, et tout chef d'équipe
 * (désigné sur au moins un service). Les membres choisis doivent être
 * dans l'équipe du service choisi (voir membresAutorisesGroupe).
 */
export function peutCreerGroupe(userRole: UserRole, estChefDUnService: boolean): boolean {
  return ROLES_RESPONSABLES.includes(userRole) || estChefDUnService;
}

/**
 * Filtre la sélection de membres d'un groupe ponctuel : uniquement des
 * membres actuels de l'équipe du service (la direction peut en plus
 * ajouter n'importe quel collègue actif — groupe transversal).
 */
export function membresAutorisesGroupe(selection: string[], equipe: Set<string>, creatorRole: UserRole, actifsOrg: Set<string>): string[] {
  const allowed = creatorRole === "direction" ? actifsOrg : equipe;
  return Array.from(new Set(selection)).filter((id) => allowed.has(id) && actifsOrg.has(id));
}

/** Supprime accents et casse pour comparer « @Rémi » à « Remi ». */
export function normaliserNom(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export const MENTION_TOUS = ["tous", "equipe", "all"];

/**
 * Mentions « @prénom » dans un message. Un mot après @ désigne le ou
 * les membres dont le prénom (premier mot du nom complet) ou le nom
 * complet sans espaces correspond, sans tenir compte des accents ni de
 * la casse. « @tous » / « @equipe » mentionne tout le groupe, réservé
 * aux responsables (sinon ignoré). L'auteur n'est jamais mentionné.
 */
export function extraireMentions(
  body: string | null | undefined,
  members: { id: string; full_name: string }[],
  options: { authorId: string; authorIsAdmin: boolean },
): string[] {
  if (!body) return [];
  const tokens = Array.from(body.matchAll(/(^|[^\p{L}\p{N}_.])@([\p{L}][\p{L}\p{N}'-]*)/gu)).map((m) => normaliserNom(m[2]!));
  if (tokens.length === 0) return [];
  const ids = new Set<string>();
  for (const t of tokens) {
    if (MENTION_TOUS.includes(t)) {
      if (options.authorIsAdmin) members.forEach((m) => ids.add(m.id));
      continue;
    }
    for (const m of members) {
      const full = normaliserNom(m.full_name);
      const prenom = full.split(/\s+/)[0] ?? "";
      if (t === prenom || t === full.replace(/\s+/g, "")) ids.add(m.id);
    }
  }
  ids.delete(options.authorId);
  return Array.from(ids);
}

/**
 * Destinataires d'une notification pour un nouveau message : tous les
 * membres sauf l'auteur. Un membre qui a mis le groupe en sourdine
 * n'est notifié que s'il est mentionné (@prénom ou @tous) — la
 * sourdine coupe aussi les Infos équipe, qui restent épinglées en
 * haut du groupe.
 */
export function destinatairesNotification(
  members: { user_id: string; muted: boolean }[],
  authorId: string,
  mentions: string[],
): { mentionnes: string[]; autres: string[] } {
  const mentionSet = new Set(mentions);
  const mentionnes: string[] = [];
  const autres: string[] = [];
  for (const m of members) {
    if (m.user_id === authorId) continue;
    if (mentionSet.has(m.user_id)) mentionnes.push(m.user_id);
    else if (!m.muted) autres.push(m.user_id);
  }
  return { mentionnes, autres };
}

/** « Vu par 3/12 » — l'auteur n'est compté ni au numérateur ni au dénominateur. */
export function libelleVuPar(readerIds: string[], memberIds: string[], authorId: string): { vus: number; total: number; libelle: string } {
  const members = new Set(memberIds.filter((id) => id !== authorId));
  const vus = new Set(readerIds.filter((id) => members.has(id))).size;
  return { vus, total: members.size, libelle: `Vu par ${vus}/${members.size}` };
}

/** Messages non lus d'un membre : postérieurs à sa dernière lecture et pas de lui. */
export function compterNonLus(messages: { sender_id: string; created_at: string }[], userId: string, lastReadAt: string | null): number {
  const since = lastReadAt ? Date.parse(lastReadAt) : -Infinity;
  return messages.filter((m) => m.sender_id !== userId && Date.parse(m.created_at) > since).length;
}

/** Pièces jointes acceptées (photos et documents courants), 15 Mo max. */
export const PIECE_JOINTE_MAX_OCTETS = 15 * 1024 * 1024;
const TYPES_DOCUMENTS = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
export function pieceJointeAcceptee(type: string, size: number): boolean {
  if (size <= 0 || size > PIECE_JOINTE_MAX_OCTETS) return false;
  return type.startsWith("image/") || TYPES_DOCUMENTS.includes(type);
}

export const REACTIONS = ["👍", "❤️", "😂", "😮", "🙏", "✅"] as const;
