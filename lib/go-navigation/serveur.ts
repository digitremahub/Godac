import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIp } from "@/lib/rental/public-access";
import { hacherIpInscription, hacherJetonInvitation, LIMITES_INSCRIPTION, ressembleJetonInvitation } from "@/lib/go-navigation/jeton";
import {
  finEssai,
  invitationUtilisable,
  MODULES_GO_NAVIGATION,
  NOM_SERVICE_GO_NAVIGATION,
  nomOrganisation,
  PLAFONDS_ESSAI,
  type FormulaireInscription,
} from "@/lib/go-navigation/offre";

/** Message unique pour tout lien inutilisable : ne dit pas s'il est inconnu, expiré, révoqué ou déjà utilisé. */
export const MESSAGE_LIEN_INVALIDE = "Ce lien d'invitation n'est pas valide ou n'est plus utilisable. Demandez un nouveau lien à GODAC.";

export interface InvitationRow {
  id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

async function compterDepuis(admin: SupabaseClient, ipHash: string, kind: "echec" | "tentative", ms: number): Promise<number> {
  const { count, error } = await admin
    .from("go_navigation_access_log")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("kind", kind)
    .gte("created_at", new Date(Date.now() - ms).toISOString());
  // Table absente (migration non appliquée) : pas de limitation, l'inscription échouera de toute façon proprement.
  return error ? 0 : (count ?? 0);
}

export async function noterAcces(admin: SupabaseClient, ipHash: string, kind: "echec" | "tentative") {
  await admin.from("go_navigation_access_log").insert({ ip_hash: ipHash, kind });
}

/** Limitation de débit de la page publique, par IP hachée. `null` = autorisé, sinon le message de refus. */
export async function limiteAtteinte(admin: SupabaseClient, headers: Headers, envoi: boolean): Promise<{ ipHash: string; message: string | null }> {
  const ipHash = hacherIpInscription(clientIp(headers));
  if ((await compterDepuis(admin, ipHash, "echec", 15 * 60_000)) >= LIMITES_INSCRIPTION.echecs15min) {
    return { ipHash, message: "Trop de tentatives. Réessayez dans quelques minutes." };
  }
  if (envoi && (await compterDepuis(admin, ipHash, "tentative", 3_600_000)) >= LIMITES_INSCRIPTION.tentativesHeure) {
    return { ipHash, message: "Trop de tentatives. Réessayez plus tard." };
  }
  return { ipHash, message: null };
}

/** Invitation encore utilisable pour ce jeton, sinon null (forme, hash, révocation, usage, expiration). */
export async function invitationValide(admin: SupabaseClient, jeton: string): Promise<InvitationRow | null> {
  if (!ressembleJetonInvitation(jeton)) return null;
  const { data, error } = await admin
    .from("go_navigation_invitations")
    .select("id, expires_at, used_at, revoked_at")
    .eq("token_hash", hacherJetonInvitation(jeton))
    .maybeSingle();
  if (error || !data) return null;
  return invitationUtilisable(data as InvitationRow) ? (data as InvitationRow) : null;
}

export type ResultatInscription =
  | { ok: true; organizationId: string; userId: string }
  | { ok: false; statut: number; message: string; echecJeton?: boolean };

/**
 * Création du compte d'essai GO Navigation, côté serveur (client service) :
 *  1. réservation atomique de l'invitation (mise à jour conditionnelle :
 *     pas encore utilisée, pas révoquée, pas expirée) ;
 *  2. compte Supabase Auth (e-mail + mot de passe, e-mail considéré
 *     confirmé : le lien est personnel) ;
 *  3. inscrire_go_navigation() : organisation (offre go_navigation, essai
 *     30 jours, sans dépassement), modules, service « GO Navigation »,
 *     profil manager qui conduit, plafonds et rattachement de l'invitation,
 *     en une seule transaction.
 * Tout échec après l'étape 1 défait ce qui a été créé et libère le lien.
 */
export async function inscrireGoNavigation(admin: SupabaseClient, form: FormulaireInscription, maintenant: Date = new Date()): Promise<ResultatInscription> {
  const invitation = await invitationValide(admin, form.jeton);
  if (!invitation) return { ok: false, statut: 410, message: MESSAGE_LIEN_INVALIDE, echecJeton: true };

  const { data: reservee } = await admin
    .from("go_navigation_invitations")
    .update({ used_at: maintenant.toISOString() })
    .eq("id", invitation.id)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", maintenant.toISOString())
    .select("id")
    .maybeSingle();
  if (!reservee) return { ok: false, statut: 410, message: MESSAGE_LIEN_INVALIDE, echecJeton: true };

  const liberer = () => admin.from("go_navigation_invitations").update({ used_at: null }).eq("id", invitation.id).is("used_by_user_id", null);
  const nomComplet = `${form.prenom} ${form.nom}`.trim();

  const { data: cree, error: authError } = await admin.auth.admin.createUser({
    email: form.email,
    password: form.motDePasse,
    email_confirm: true,
    user_metadata: { full_name: nomComplet },
  });
  if (authError || !cree?.user) {
    await liberer();
    if ((authError as { code?: string } | null)?.code === "weak_password") {
      return { ok: false, statut: 400, message: "Mot de passe trop faible : choisissez-en un plus long ou plus varié." };
    }
    // Message identique que l'adresse existe déjà ou non (pas d'énumération).
    return { ok: false, statut: 400, message: "Inscription impossible avec ces informations. Si vous avez déjà un compte GODAC, connectez-vous ou contactez GODAC." };
  }

  const { data: organizationId, error: rpcError } = await admin.rpc("inscrire_go_navigation", {
    p_invitation_id: invitation.id,
    p_user_id: cree.user.id,
    p_email: form.email,
    p_full_name: nomComplet,
    p_org_name: nomOrganisation(form.prenom, form.nom),
    p_trial_ends_at: finEssai(maintenant).toISOString(),
    p_modules: [...MODULES_GO_NAVIGATION],
    p_service_name: NOM_SERVICE_GO_NAVIGATION,
    p_quotas: PLAFONDS_ESSAI.map((q) => ({ ...q })),
  });
  if (rpcError || !organizationId) {
    console.error("inscrireGoNavigation: création impossible", rpcError?.message);
    await admin.auth.admin.deleteUser(cree.user.id).catch(() => undefined);
    await liberer();
    return { ok: false, statut: 503, message: "L'inscription n'est pas disponible pour le moment. Réessayez plus tard ou contactez GODAC." };
  }

  return { ok: true, organizationId: organizationId as string, userId: cree.user.id };
}
