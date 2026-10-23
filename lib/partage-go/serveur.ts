import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { garderApi, refus, type CorpsRefus } from "@/lib/acces/garde-api";
import type { AppUser } from "@/lib/auth/session";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { lireEtatOffre } from "@/lib/go-navigation/etat";
import { deriverJetonApporteur } from "@/lib/go-navigation/jeton";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { droitPartageGo, MAX_CREATIONS_PAR_JOUR, MESSAGE_DROIT_PARTAGE_GO, MESSAGE_MIGRATION_PARTAGE_GO } from "@/lib/partage-go/apporteur";

export interface DroitPartage {
  autorise: boolean;
  /** users.peut_partager_go (colonne absente = false). */
  peutPartager: boolean;
  /** organizations.partage_go_tous (colonne absente = false). */
  partageTous: boolean;
}

/**
 * Droit « Faire essayer GO » d'une personne. La direction l'a toujours (une
 * seule lecture, celle de l'offre, déjà faite par l'appelant) ; les autres
 * rôles : personne désignée ou réglage « toute l'équipe ». Colonnes absentes
 * (migration 20261103000003 pas appliquée) : seule la direction a le droit.
 */
export async function lireDroitPartage(
  client: SupabaseClient,
  p: { userId: string; organizationId: string; role: string; goNavigation: boolean },
): Promise<DroitPartage> {
  if (p.goNavigation) return { autorise: false, peutPartager: false, partageTous: false };
  const direction = p.role === "direction";
  let peutPartager = false;
  let partageTous = false;
  try {
    const [u, o] = await Promise.all([
      direction ? Promise.resolve({ data: null, error: null }) : client.from("users").select("peut_partager_go").eq("id", p.userId).maybeSingle(),
      client.from("organizations").select("partage_go_tous").eq("id", p.organizationId).maybeSingle(),
    ]);
    if (!u.error) peutPartager = Boolean((u.data as { peut_partager_go?: boolean | null } | null)?.peut_partager_go);
    if (!o.error) partageTous = Boolean((o.data as { partage_go_tous?: boolean | null } | null)?.partage_go_tous);
  } catch (e) {
    console.error("lireDroitPartage", e);
  }
  return { autorise: droitPartageGo({ role: p.role, peutPartager, partageTous, offreGoNavigation: false }), peutPartager, partageTous };
}

/** Droit d'une personne retrouvée par son id (service) : sert à désactiver les liens de quelqu'un qui n'a plus le droit. */
export async function apporteurAutorise(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data: u, error } = await admin.from("users").select("role, active, organization_id").eq("id", userId).maybeSingle();
  if (error || !u || !(u as { active?: boolean }).active) return false;
  const { role, organization_id: organizationId } = u as { role: string; organization_id: string };
  const offre = await lireEtatOffre(admin, organizationId);
  return (await lireDroitPartage(admin, { userId, organizationId, role, goNavigation: offre.goNavigation })).autorise;
}

export type ResultatGardePartage = { ok: true; appUser: AppUser; admin: SupabaseClient } | { ok: false; reponse: NextResponse<CorpsRefus> };

/**
 * Garde des routes /api/partage-go : connexion, puis droit « Faire essayer
 * GO » vérifié côté serveur. Les lectures et écritures passent ensuite par
 * le client service, TOUJOURS filtrées par l'id ou l'organisation de la
 * personne connectée (jamais par un paramètre du client).
 */
export async function garderPartageGo(): Promise<ResultatGardePartage> {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g;
  const offre = await lireEtatOffre(g.supabase, g.appUser.organization_id);
  const droit = await lireDroitPartage(g.supabase, { userId: g.appUser.id, organizationId: g.appUser.organization_id, role: g.appUser.role, goNavigation: offre.goNavigation });
  if (!droit.autorise) return { ok: false, reponse: refus("ROLE_REFUSE", MESSAGE_DROIT_PARTAGE_GO) };
  return { ok: true, appUser: g.appUser, admin: createAdminSupabaseClient() };
}

/** Réponse d'erreur d'une requête : message clair si la migration manque, sinon erreur générique. */
export function reponseErreurBase(contexte: string, error: { code?: string | null; message?: string | null }): NextResponse {
  if (estSchemaManquant(error)) return NextResponse.json({ error: MESSAGE_MIGRATION_PARTAGE_GO }, { status: 503 });
  console.error(`partage-go (${contexte})`, error.message);
  return NextResponse.json({ error: "Action impossible pour le moment. Réessayez dans un instant." }, { status: 500 });
}

/** Liens + invitations créés par cette personne sur 24 h (régénérer un lien compte ; une inscription par lien non). */
export async function compterCreations24h(admin: SupabaseClient, userId: string): Promise<{ total: number; error: { code?: string | null; message?: string | null } | null }> {
  const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [liens, invitations] = await Promise.all([
    admin.from("go_apporteur_liens").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", depuis),
    admin.from("go_navigation_invitations").select("id", { count: "exact", head: true }).eq("created_by_user_id", userId).is("referral_link_id", null).gte("created_at", depuis),
  ]);
  const error = liens.error ?? invitations.error;
  return { total: (liens.count ?? 0) + (invitations.count ?? 0), error };
}

export const MESSAGE_LIMITE_CREATION = `Limite atteinte : ${MAX_CREATIONS_PAR_JOUR} liens ou invitations par jour. Réessayez demain.`;

/** Secret de dérivation des jetons de lien personnel (variable dédiée, sinon la clé service, toujours présente côté serveur). */
function secretLiens(): string {
  const s = process.env.GO_APPORTEUR_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Secret des liens d'apporteur indisponible");
  return s;
}

export function jetonLienPersonnel(lienId: string): string {
  return deriverJetonApporteur(lienId, secretLiens());
}

/** Chemin public d'un lien personnel : le même écran d'inscription que les invitations. */
export function cheminLienPersonnel(lienId: string): string {
  return `/go-navigation/${jetonLienPersonnel(lienId)}`;
}
