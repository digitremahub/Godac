import "server-only";
import type { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { refus, type CorpsRefus } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { destinatairesNotification, peutDecider, TRACE_AUTO_VALIDEE, type EffectifsRoles, type PersonneHierarchie, type UtilisateurOrganisation } from "@/lib/hierarchie/demandes";

/**
 * Accès aux données de la hiérarchie des demandes (lib/hierarchie/demandes.ts
 * pour les règles). Lectures sous la RLS « users : lecture dans
 * l'organisation » : aucun droit supplémentaire.
 */

type Db = SupabaseClient;

/** Comptes direction actifs de l'organisation (lecture impossible : 1, la direction n'est jamais bloquée). */
export async function compterDirection(db: Db, organizationId: string): Promise<number> {
  const { count, error } = await db
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "direction")
    .eq("active", true);
  if (error || count === null) return 1;
  return count;
}

/** Effectifs actifs par rôle (libellés « En attente de … » avec escalade). */
export async function effectifsRoles(db: Db, organizationId: string): Promise<EffectifsRoles> {
  const { data } = await db.from("users").select("role").eq("organization_id", organizationId).eq("active", true).in("role", ["manager", "exploitation", "direction"]);
  const e: EffectifsRoles = { manager: 0, exploitation: 0, direction: 0 };
  for (const u of (data ?? []) as { role: string }[]) {
    const r = u.role === "manager_chauffeur" ? "manager" : u.role;
    if (r === "manager" || r === "exploitation" || r === "direction") e[r] = (e[r] ?? 0) + 1;
  }
  return e;
}

/** Comptes actifs de l'organisation avec leurs services (pour acheminer une demande). */
export async function utilisateursOrganisation(db: Db, organizationId: string): Promise<UtilisateurOrganisation[]> {
  const { data } = await db.from("users").select("id, role, active").eq("organization_id", organizationId).eq("active", true);
  const users = (data ?? []) as { id: string; role: string; active: boolean }[];
  if (users.length === 0) return [];
  const { data: liens } = await db.from("user_services").select("user_id, service_id").in("user_id", users.map((u) => u.id));
  const parUtilisateur = new Map<string, string[]>();
  for (const l of (liens ?? []) as { user_id: string; service_id: string }[]) parUtilisateur.set(l.user_id, [...(parUtilisateur.get(l.user_id) ?? []), l.service_id]);
  return users.map((u) => ({ id: u.id, role: u.role, active: u.active, serviceIds: parUtilisateur.get(u.id) ?? [] }));
}

/** Rôle et services d'une personne ; null si introuvable (autre organisation comprise). */
export async function lirePersonne(db: Db, organizationId: string, userId: string): Promise<PersonneHierarchie | null> {
  const { data } = await db.from("users").select("id, role").eq("id", userId).eq("organization_id", organizationId).maybeSingle();
  if (!data) return null;
  const { data: liens } = await db.from("user_services").select("service_id").eq("user_id", userId);
  return { id: data.id as string, role: data.role as string, serviceIds: ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id) };
}

export type ResultatGardeDecision =
  | { ok: true; autoValidee: boolean }
  | { ok: false; reponse: NextResponse<CorpsRefus>; raison: string };

/**
 * Garde commun des routes de décision : `appUser` peut-il décider ou
 * résoudre la demande de `demandeur` ? 403 avec un message clair sinon.
 * `demandeur` : identifiant (son rôle est relu) ou personne déjà connue.
 * Demandeur introuvable : seule la règle « pas sa propre demande » joue
 * (la RLS borne le reste). `paie` : décision de paie que le comptable garde.
 * Une direction seule qui décide de sa propre demande passe, avec
 * `autoValidee: true` : l'appelant trace alors tracerAutoValidation().
 */
export async function garderDecision(
  db: Db,
  appUser: Pick<AppUser, "id" | "role" | "organization_id">,
  demandeur: string | PersonneHierarchie,
  options: { paie?: boolean } = {},
): Promise<ResultatGardeDecision> {
  const idDemandeur = typeof demandeur === "string" ? demandeur : demandeur.id;
  const personne = typeof demandeur === "string" ? await lirePersonne(db, appUser.organization_id, demandeur) : demandeur;
  const directionCount = appUser.role === "direction" || personne?.role === "direction" ? await compterDirection(db, appUser.organization_id) : 2;
  const verdict = peutDecider({
    decideur: { id: appUser.id, role: appUser.role },
    demandeur: personne ?? { id: idDemandeur, role: idDemandeur === appUser.id ? appUser.role : "chauffeur" },
    directionCount,
    paie: options.paie,
  });
  if (verdict.ok) return { ok: true, autoValidee: Boolean(verdict.autoValidee) };
  return { ok: false, reponse: refus("ROLE_REFUSE", verdict.raison), raison: verdict.raison };
}

/** Trace d'audit d'une demande qu'une direction seule a décidée pour elle-même. */
export async function tracerAutoValidation(appUser: Pick<AppUser, "id" | "organization_id">, p: { table: string; id: string; decision: string }): Promise<void> {
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "demande_auto_validee",
    targetTable: p.table,
    targetId: p.id,
    details: { decision: p.decision, mention: TRACE_AUTO_VALIDEE },
  });
}

/** Personnes à prévenir pour une demande de ce demandeur (niveau au-dessus, escalade comprise). */
export async function destinatairesDe(db: Db, organizationId: string, demandeurId: string): Promise<UtilisateurOrganisation[]> {
  const utilisateurs = await utilisateursOrganisation(db, organizationId);
  const demandeur = utilisateurs.find((u) => u.id === demandeurId);
  if (!demandeur) return [];
  return destinatairesNotification(demandeur, utilisateurs).destinataires;
}

export interface AlerteHierarchique {
  organizationId: string;
  /** Auteur de la demande : l'alerte monte d'un niveau, jamais vers lui ni un pair. */
  demandeurId: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  relatedTable: string;
  relatedId: string;
}

/**
 * Alerte une demande au niveau juste au-dessus de son auteur (avec
 * escalade), une alerte personnelle par destinataire. Personne au-dessus
 * (direction seule) : aucune alerte. Retourne le message d'erreur éventuel.
 */
export async function alerterNiveauSuperieur(admin: Db, a: AlerteHierarchique): Promise<string | null> {
  const destinataires = await destinatairesDe(admin, a.organizationId, a.demandeurId);
  if (destinataires.length === 0) return null;
  const { error } = await admin.from("alerts").insert(
    destinataires.map((u) => ({
      organization_id: a.organizationId,
      type: a.type,
      severity: a.severity,
      message: a.message,
      related_table: a.relatedTable,
      related_id: a.relatedId,
      recipient_user_id: u.id,
    })),
  );
  return error?.message ?? null;
}
