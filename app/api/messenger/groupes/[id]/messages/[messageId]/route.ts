import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { chargerAccesGroupe } from "@/lib/messenger/groupes-serveur";
import { REACTIONS, peutAdministrerGroupe, peutReagir, peutSupprimerMessage } from "@/lib/messenger/groupes";

const patchSchema = z.object({
  /** Responsables : épingler / désépingler (une Info équipe épinglée reste en haut du groupe). */
  pinned: z.boolean().optional(),
  /** Membres : ajoute la réaction, ou la retire si elle y est déjà. */
  reaction: z.enum(REACTIONS).optional(),
});

async function charger(groupId: string, messageId: string) {
  const appUser = await requireAppUser();
  const ctx = await chargerAccesGroupe(appUser, groupId);
  if (!ctx) return null;
  const { data: message } = await ctx.admin
    .from("group_messages")
    .select("id, sender_id, attachment_path, pinned_at")
    .eq("id", messageId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!message) return null;
  return { appUser, ...ctx, message };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const ctx = await charger(id, messageId);
  if (!ctx) return NextResponse.json({ error: "Message introuvable." }, { status: 404 });
  const { appUser, access, admin, message } = ctx;

  if (parsed.data.pinned !== undefined) {
    if (!peutAdministrerGroupe(access)) return NextResponse.json({ error: "Réservé aux responsables du groupe." }, { status: 403 });
    const { error } = await admin
      .from("group_messages")
      .update(parsed.data.pinned ? { pinned_at: new Date().toISOString(), pinned_by: appUser.id } : { pinned_at: null, pinned_by: null })
      .eq("id", message.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (parsed.data.reaction) {
    if (!peutReagir(access)) return NextResponse.json({ error: "Vous n'êtes pas membre de ce groupe." }, { status: 403 });
    const supabase = await createServerSupabaseClient();
    const { data: existing } = await supabase
      .from("group_message_reactions")
      .select("emoji")
      .eq("message_id", message.id)
      .eq("user_id", appUser.id)
      .eq("emoji", parsed.data.reaction)
      .maybeSingle();
    const { error } = existing
      ? await supabase.from("group_message_reactions").delete().eq("message_id", message.id).eq("user_id", appUser.id).eq("emoji", parsed.data.reaction)
      : await supabase.from("group_message_reactions").insert({ message_id: message.id, user_id: appUser.id, emoji: parsed.data.reaction });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** Suppression par son auteur, ou modération par un responsable du groupe. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  const ctx = await charger(id, messageId);
  if (!ctx) return NextResponse.json({ error: "Message introuvable." }, { status: 404 });
  const { appUser, access, admin, message } = ctx;
  if (!peutSupprimerMessage(access, message.sender_id, appUser.id)) {
    return NextResponse.json({ error: "Message introuvable." }, { status: 404 });
  }
  if (message.attachment_path) await admin.storage.from("messenger-photos").remove([message.attachment_path]);
  const { error } = await admin.from("group_messages").delete().eq("id", message.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
