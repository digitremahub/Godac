import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { chargerAccesGroupe, notifierMessageGroupe } from "@/lib/messenger/groupes-serveur";
import { extraireMentions, peutAdministrerGroupe, peutEcrireGroupe } from "@/lib/messenger/groupes";

const bodySchema = z
  .object({
    body: z.string().trim().max(4000).optional(),
    attachment_path: z.string().max(300).optional(),
    attachment_name: z.string().trim().max(200).optional(),
    attachment_type: z.string().max(120).optional(),
    /** « Info équipe » : message épinglé en haut du groupe, avec « vu par X/Y ». */
    announcement: z.boolean().optional(),
  })
  .refine((d) => Boolean(d.body) || Boolean(d.attachment_path), { message: "Message vide." });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["messenger"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "messenger"))) {
    return NextResponse.json({ error: "Module Messenger non activé." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Message vide ou trop long." }, { status: 400 });
  const input = parsed.data;

  const ctx = await chargerAccesGroupe(appUser, id);
  if (!ctx) return NextResponse.json({ error: "Groupe introuvable." }, { status: 404 });
  const { group, access, admin } = ctx;

  if (!peutEcrireGroupe(access, group.announcement_only)) {
    return NextResponse.json(
      { error: access.memberRole ? "Seuls les responsables écrivent dans ce groupe." : "Rejoignez le groupe pour écrire." },
      { status: 403 },
    );
  }
  const isAnnouncement = Boolean(input.announcement);
  if (isAnnouncement && !peutAdministrerGroupe(access)) {
    return NextResponse.json({ error: "Seuls les responsables publient une Info équipe." }, { status: 403 });
  }
  // Même convention que la messagerie 1:1 : le fichier est dans le dossier de l'expéditeur.
  if (input.attachment_path && !input.attachment_path.startsWith(`${appUser.organization_id}/${appUser.id}/`)) {
    return NextResponse.json({ error: "Chemin de pièce jointe invalide." }, { status: 400 });
  }

  const { data: members } = await admin.from("message_group_members").select("user_id, users!inner(full_name, active)").eq("group_id", group.id);
  const annuaire = ((members ?? []) as any[])
    .filter((m) => m.users?.active)
    .map((m) => ({ id: m.user_id as string, full_name: (m.users?.full_name as string) ?? "" }));
  const mentions = extraireMentions(input.body, annuaire, { authorId: appUser.id, authorIsAdmin: peutAdministrerGroupe(access) });

  // Client de l'utilisateur : la politique « post when allowed » revérifie les droits en base.
  const { data: message, error } = await supabase
    .from("group_messages")
    .insert({
      organization_id: appUser.organization_id,
      group_id: group.id,
      sender_id: appUser.id,
      body: input.body || null,
      attachment_path: input.attachment_path ?? null,
      attachment_name: input.attachment_path ? (input.attachment_name ?? null) : null,
      attachment_type: input.attachment_path ? (input.attachment_type ?? null) : null,
      is_announcement: isAnnouncement,
      mentions,
    })
    .select("id")
    .single();
  if (error || !message) return NextResponse.json({ error: error?.message ?? "Envoi impossible." }, { status: 500 });

  if (isAnnouncement) {
    await admin.from("group_messages").update({ pinned_at: new Date().toISOString(), pinned_by: appUser.id }).eq("id", message.id);
  }
  // L'auteur a lu son propre message.
  await supabase.from("message_group_members").update({ last_read_at: new Date().toISOString() }).eq("group_id", group.id).eq("user_id", appUser.id);

  try {
    await notifierMessageGroupe({
      admin,
      appUser,
      group,
      body: input.body || null,
      hasAttachment: Boolean(input.attachment_path),
      isAnnouncement,
      mentions,
    });
  } catch (e) {
    console.warn("messenger/groupes: notification failed", e);
  }

  return NextResponse.json({ ok: true, messageId: message.id });
}
