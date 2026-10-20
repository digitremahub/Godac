import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendPushToSubscriptions } from "@/lib/push/send";
import { destinatairesNotification, type GroupAccess, type GroupMemberRole } from "@/lib/messenger/groupes";

export interface GroupRow {
  id: string;
  organization_id: string;
  service_id: string | null;
  kind: "team" | "custom";
  name: string;
  announcement_only: boolean;
  created_by: string | null;
}

/**
 * Charge un groupe et le rôle du signed-in user dedans, avec le client
 * admin (les routes d'administration écrivent avec lui) mais borné à
 * l'organisation de l'utilisateur. null si le groupe n'existe pas
 * dans son organisation.
 */
export async function chargerAccesGroupe(
  appUser: AppUser,
  groupId: string,
): Promise<{ group: GroupRow; access: GroupAccess; admin: SupabaseClient } | null> {
  const admin = createAdminSupabaseClient();
  const { data: group } = await admin
    .from("message_groups")
    .select("id, organization_id, service_id, kind, name, announcement_only, created_by")
    .eq("id", groupId)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (!group) return null;
  const { data: me } = await admin.from("message_group_members").select("role").eq("group_id", groupId).eq("user_id", appUser.id).maybeSingle();
  return {
    group: group as GroupRow,
    access: { userRole: appUser.role, memberRole: (me?.role as GroupMemberRole | undefined) ?? null, active: appUser.active && !appUser.pending_approval },
    admin,
  };
}

const extrait = (body: string | null, hasAttachment: boolean) => {
  if (!body) return hasAttachment ? "📎 Pièce jointe" : "";
  return body.length > 120 ? `${body.slice(0, 117)}...` : body;
};

/**
 * Notifie les membres d'un nouveau message de groupe :
 * - mentionnés (@prénom / @tous) et Infos équipe → une alerte par
 *   destinataire (cloche + e-mail + push via le webhook des alertes) ;
 * - autres membres non en sourdine → push direct, sans e-mail (un
 *   groupe actif ne doit pas remplir les boîtes mail).
 * Jamais pour une organisation de démo (comptes fictifs).
 */
export async function notifierMessageGroupe(opts: {
  admin: SupabaseClient;
  appUser: AppUser;
  group: GroupRow;
  body: string | null;
  hasAttachment: boolean;
  isAnnouncement: boolean;
  mentions: string[];
}): Promise<void> {
  const { admin, appUser, group } = opts;
  const { data: members } = await admin
    .from("message_group_members")
    .select("user_id, muted, users!inner(active)")
    .eq("group_id", group.id)
    .eq("users.active", true);
  const membres = ((members ?? []) as { user_id: string; muted: boolean }[]).map((m) => ({ user_id: m.user_id, muted: m.muted }));
  const { mentionnes, autres } = destinatairesNotification(membres, appUser.id, opts.mentions);

  const texte = extrait(opts.body, opts.hasAttachment);
  const prenom = appUser.full_name.split(/\s+/)[0] ?? appUser.full_name;
  const alertes = opts.isAnnouncement ? [...mentionnes, ...autres] : mentionnes;
  const pushSeul = opts.isAnnouncement ? [] : autres;

  if (alertes.length > 0) {
    const { error } = await admin.from("alerts").insert(
      alertes.map((userId) => ({
        organization_id: group.organization_id,
        type: "group_message",
        severity: "info",
        message: opts.isAnnouncement
          ? `Info équipe « ${group.name} » de ${appUser.full_name} : ${texte}`
          : `${appUser.full_name} vous a mentionné dans « ${group.name} » : ${texte}`,
        related_table: "message_groups",
        related_id: group.id,
        recipient_user_id: userId,
      })),
    );
    if (error) console.warn(`messenger/groupes: alert insert failed: ${error.message}`);
  }

  if (pushSeul.length === 0) return;
  const { data: org } = await admin.from("organizations").select("is_demo").eq("id", group.organization_id).maybeSingle();
  if (org?.is_demo) return;
  const { data: subscriptions } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", pushSeul);
  await sendPushToSubscriptions(admin, subscriptions ?? [], {
    title: group.name,
    body: `${prenom} : ${texte}`,
    url: `/communication/messenger?groupe=${group.id}`,
  });
}
