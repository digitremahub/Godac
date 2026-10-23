import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIp } from "@/lib/rental/public-access";
import { genererJetonInvitation, hacherIpInscription, hacherJetonInvitation, LIMITES_INSCRIPTION, ressembleJetonInvitation } from "@/lib/go-navigation/jeton";
import { apporteurAutorise } from "@/lib/partage-go/serveur";
import { attributionDepuis, depasseMaxInscriptions, libelleApporteur, lienUtilisable, type Attribution } from "@/lib/partage-go/apporteur";
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

/**
 * Jeton d'inscription résolu : soit une invitation à usage unique (staff
 * GODAC ou apporteur), soit le lien personnel multi-usage d'un apporteur.
 * `attribution` vient de la base (jamais du client).
 */
export interface JetonResolu {
  type: "invitation" | "lien";
  /** id de l'invitation, ou du lien personnel. */
  id: string;
  attribution: Attribution;
}

/** Nombre d'inscriptions retenues par un lien personnel (les tentatives abandonnées sont marquées révoquées). */
async function inscritsDuLien(admin: SupabaseClient, lienId: string): Promise<number> {
  const { count } = await admin.from("go_navigation_invitations").select("id", { count: "exact", head: true }).eq("referral_link_id", lienId).is("revoked_at", null);
  return count ?? 0;
}

/**
 * Jeton encore utilisable, sinon null (forme, hash, révocation, usage,
 * expiration, maximum d'inscriptions, apporteur qui n'a plus le droit). Les
 * colonnes et la table du suivi d'apporteur peuvent manquer (migration
 * 20261103000003 pas encore appliquée) : on retombe sur le comportement
 * historique (invitations du staff).
 */
export async function jetonValide(admin: SupabaseClient, jeton: string, maintenant: Date = new Date()): Promise<JetonResolu | null> {
  if (!ressembleJetonInvitation(jeton)) return null;
  const hash = hacherJetonInvitation(jeton);

  const { data, error } = await admin.from("go_navigation_invitations").select("id, expires_at, used_at, revoked_at").eq("token_hash", hash).maybeSingle();
  if (!error && data) {
    if (!invitationUtilisable(data as InvitationRow, maintenant)) return null;
    const inv = data as InvitationRow;
    const { data: src } = await admin.from("go_navigation_invitations").select("created_by_user_id, created_by_org_id, referral_link_id").eq("id", inv.id).maybeSingle();
    const attribution = attributionDepuis(src as { created_by_user_id?: string | null; created_by_org_id?: string | null; referral_link_id?: string | null } | null);
    if (attribution.referred_by_user_id && !(await apporteurAutorise(admin, attribution.referred_by_user_id))) return null;
    return { type: "invitation", id: inv.id, attribution };
  }

  const { data: lien, error: errLien } = await admin
    .from("go_apporteur_liens")
    .select("id, organization_id, user_id, expires_at, revoked_at, max_inscriptions")
    .eq("code_hash", hash)
    .maybeSingle();
  if (errLien || !lien) return null;
  const l = lien as { id: string; organization_id: string; user_id: string; expires_at: string; revoked_at: string | null; max_inscriptions: number };
  if (!lienUtilisable(l, await inscritsDuLien(admin, l.id), maintenant)) return null;
  if (!(await apporteurAutorise(admin, l.user_id))) return null;
  return { type: "lien", id: l.id, attribution: attributionDepuis({ created_by_user_id: l.user_id, created_by_org_id: l.organization_id, referral_link_id: l.id }) };
}

/** « Invité par Jean Dupont » pour la page d'inscription : nom (ou organisation), jamais d'e-mail. */
export async function libelleInvitePar(admin: SupabaseClient, attribution: Attribution): Promise<string | null> {
  if (!attribution.referred_by_user_id) return null;
  const [u, o] = await Promise.all([
    admin.from("users").select("full_name").eq("id", attribution.referred_by_user_id).maybeSingle(),
    attribution.referred_by_org_id ? admin.from("organizations").select("name").eq("id", attribution.referred_by_org_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return libelleApporteur((u.data as { full_name?: string } | null)?.full_name, (o.data as { name?: string } | null)?.name);
}

export type ResultatInscription =
  | { ok: true; organizationId: string; userId: string; apporteurUserId: string | null; apporteurOrgId: string | null; lienId: string | null }
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
  const jeton = await jetonValide(admin, form.jeton, maintenant);
  if (!jeton) return { ok: false, statut: 410, message: MESSAGE_LIEN_INVALIDE, echecJeton: true };

  // Identifiant de l'invitation qui portera le compte : l'invitation elle-même,
  // ou (lien personnel) une ligne créée ici, déjà « utilisée », pour que
  // inscrire_go_navigation() reste inchangée.
  let invitationId: string;
  let liberer: () => PromiseLike<unknown>;
  if (jeton.type === "invitation") {
    const { data: reservee } = await admin
      .from("go_navigation_invitations")
      .update({ used_at: maintenant.toISOString() })
      .eq("id", jeton.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .gt("expires_at", maintenant.toISOString())
      .select("id")
      .maybeSingle();
    if (!reservee) return { ok: false, statut: 410, message: MESSAGE_LIEN_INVALIDE, echecJeton: true };
    invitationId = jeton.id;
    liberer = () => admin.from("go_navigation_invitations").update({ used_at: null }).eq("id", invitationId).is("used_by_user_id", null);
  } else {
    const reserve = await reserverPlaceLien(admin, jeton, maintenant);
    if (!reserve) return { ok: false, statut: 410, message: MESSAGE_LIEN_INVALIDE, echecJeton: true };
    invitationId = reserve;
    // Tentative abandonnée : la ligne ne compte plus dans le maximum du lien.
    liberer = () => admin.from("go_navigation_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", invitationId).is("used_by_user_id", null);
  }
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
    p_invitation_id: invitationId,
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

  // Attribution de l'apporteur sur l'organisation d'essai, posée depuis le jeton
  // résolu côté serveur. Un échec ne défait pas le compte : l'invitation porte
  // déjà l'apporteur (created_by_*), on le consigne pour le rattraper.
  if (jeton.attribution.referred_by_user_id) {
    const { error: errAttribution } = await admin.from("organizations").update(jeton.attribution).eq("id", organizationId as string);
    if (errAttribution) console.error("inscrireGoNavigation: attribution de l'apporteur non enregistrée", errAttribution.message);
  }

  return { ok: true, organizationId: organizationId as string, userId: cree.user.id, apporteurUserId: jeton.attribution.referred_by_user_id, apporteurOrgId: jeton.attribution.referred_by_org_id, lienId: jeton.attribution.referral_link_id };
}

/**
 * Réserve une place sur un lien personnel : crée l'invitation « utilisée »
 * qui portera le compte, puis recompte. Si le maximum est dépassé (deux
 * inscriptions simultanées sur la dernière place), la ligne est annulée.
 * Renvoie l'id de la ligne, ou null.
 */
async function reserverPlaceLien(admin: SupabaseClient, jeton: JetonResolu, maintenant: Date): Promise<string | null> {
  const { referred_by_user_id: userId, referred_by_org_id: orgId, referral_link_id: lienId } = jeton.attribution;
  if (!userId || !orgId || !lienId) return null;
  const [{ data: apporteur }, { data: lien }] = await Promise.all([
    admin.from("users").select("email").eq("id", userId).maybeSingle(),
    admin.from("go_apporteur_liens").select("max_inscriptions").eq("id", lienId).maybeSingle(),
  ]);
  const max = (lien as { max_inscriptions?: number } | null)?.max_inscriptions;
  if (!max) return null;
  const { data: ligne, error } = await admin
    .from("go_navigation_invitations")
    .insert({
      // Jeton jamais communiqué : la ligne n'est pas un lien utilisable, juste le support du compte.
      token_hash: hacherJetonInvitation(genererJetonInvitation()),
      note: "Lien personnel",
      expires_at: maintenant.toISOString(),
      used_at: maintenant.toISOString(),
      created_by_email: ((apporteur as { email?: string } | null)?.email ?? "apporteur").toLowerCase(),
      created_by_user_id: userId,
      created_by_org_id: orgId,
      referral_link_id: lienId,
    })
    .select("id")
    .single();
  if (error || !ligne) {
    console.error("inscrireGoNavigation: réservation du lien personnel", error?.message);
    return null;
  }
  if (depasseMaxInscriptions(await inscritsDuLien(admin, lienId), max)) {
    await admin.from("go_navigation_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", ligne.id);
    return null;
  }
  return ligne.id as string;
}
