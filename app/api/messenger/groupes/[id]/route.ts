import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { chargerAccesGroupe } from "@/lib/messenger/groupes-serveur";
import { membresAutorisesGroupe, peutAdministrerGroupe } from "@/lib/messenger/groupes";

const patchSchema = z.object({
  /** Préférence personnelle : sourdine des notifications du groupe. */
  muted: z.boolean().optional(),
  /** Responsables : renommer (groupes ponctuels seulement). */
  name: z.string().trim().min(1).max(80).optional(),
  /** Responsables : « seuls les responsables écrivent ». */
  announcement_only: z.boolean().optional(),
  /** Responsables, groupes ponctuels : membres ajoutés / retirés. */
  add_member_ids: z.array(z.string().uuid()).max(500).optional(),
  remove_member_ids: z.array(z.string().uuid()).max(500).optional(),
  /** Direction : rejoindre / quitter le groupe ; tout membre : quitter un groupe ponctuel. */
  join: z.literal(true).optional(),
  leave: z.literal(true).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["messenger"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "messenger"))) {
    return NextResponse.json({ error: "Module Messenger non activé." }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const input = parsed.data;

  const ctx = await chargerAccesGroupe(appUser, id);
  if (!ctx) return NextResponse.json({ error: "Groupe introuvable." }, { status: 404 });
  const { group, access, admin } = ctx;

  if (input.join) {
    if (appUser.role !== "direction" && appUser.role !== "exploitation") return NextResponse.json({ error: "Réservé à la direction et à l'exploitation." }, { status: 403 });
    if (!access.memberRole) {
      const { error } = await admin.from("message_group_members").insert({
        group_id: group.id,
        organization_id: appUser.organization_id,
        user_id: appUser.id,
        role: "admin",
        source: "manual",
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (input.leave) {
    const { data: me } = await admin.from("message_group_members").select("source").eq("group_id", group.id).eq("user_id", appUser.id).maybeSingle();
    if (!me) return NextResponse.json({ ok: true });
    if (group.kind === "team" && me.source === "auto") {
      return NextResponse.json({ error: "Vous faites partie de cette équipe : mettez plutôt le groupe en sourdine." }, { status: 400 });
    }
    await admin.from("message_group_members").delete().eq("group_id", group.id).eq("user_id", appUser.id);
    return NextResponse.json({ ok: true });
  }

  if (input.muted !== undefined) {
    if (!access.memberRole) return NextResponse.json({ error: "Vous n'êtes pas membre de ce groupe." }, { status: 403 });
    // Client de l'utilisateur : la base ne lui laisse modifier que sa sourdine et sa lecture.
    const { error } = await supabase.from("message_group_members").update({ muted: input.muted }).eq("group_id", group.id).eq("user_id", appUser.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const adminChanges = input.name !== undefined || input.announcement_only !== undefined || input.add_member_ids || input.remove_member_ids;
  if (!adminChanges) return NextResponse.json({ ok: true });
  if (!peutAdministrerGroupe(access)) {
    return NextResponse.json({ error: "Réservé aux responsables du groupe." }, { status: 403 });
  }

  const update: Record<string, unknown> = {};
  if (input.announcement_only !== undefined) update.announcement_only = input.announcement_only;
  if (input.name !== undefined) {
    if (group.kind === "team") return NextResponse.json({ error: "Le groupe d'équipe porte le nom du service." }, { status: 400 });
    update.name = input.name;
  }
  if (Object.keys(update).length > 0) {
    const { error } = await admin.from("message_groups").update(update).eq("id", group.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (input.add_member_ids || input.remove_member_ids) {
    if (group.kind === "team") {
      return NextResponse.json({ error: "Les membres du groupe d'équipe suivent le service (Utilisateurs > services)." }, { status: 400 });
    }
    let equipe = new Map<string, string>();
    if (group.service_id) {
      const { data: team } = await admin
        .from("message_groups")
        .select("message_group_members(user_id, role)")
        .eq("service_id", group.service_id)
        .eq("kind", "team")
        .maybeSingle();
      equipe = new Map(((team?.message_group_members ?? []) as { user_id: string; role: string }[]).map((m) => [m.user_id, m.role]));
    }
    if (input.add_member_ids?.length) {
      const { data: actifs } = await admin
        .from("users")
        .select("id")
        .eq("organization_id", appUser.organization_id)
        .eq("active", true)
        .eq("pending_approval", false);
      // Groupe transversal (sans service) : seule la direction le gère, avec toute l'organisation.
      const role = group.service_id ? appUser.role : "direction";
      const ids = membresAutorisesGroupe(input.add_member_ids, new Set(equipe.keys()), role, new Set((actifs ?? []).map((u) => u.id as string)));
      if (ids.length > 0) {
        const { error } = await admin.from("message_group_members").upsert(
          ids.map((uid) => ({
            group_id: group.id,
            organization_id: appUser.organization_id,
            user_id: uid,
            role: equipe.get(uid) === "admin" ? "admin" : "member",
            source: "manual",
          })),
          { onConflict: "group_id,user_id", ignoreDuplicates: true },
        );
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    const toRemove = (input.remove_member_ids ?? []).filter((uid) => uid !== appUser.id);
    if (toRemove.length > 0) {
      await admin.from("message_group_members").delete().eq("group_id", group.id).in("user_id", toRemove);
    }
  }

  return NextResponse.json({ ok: true });
}

/** Supprime un groupe ponctuel (et ses messages). Le groupe d'équipe, lui, vit avec le service. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g2 = await garderApi({ modules: ["messenger"] });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  const ctx = await chargerAccesGroupe(appUser, id);
  if (!ctx) return NextResponse.json({ error: "Groupe introuvable." }, { status: 404 });
  const { group, access, admin } = ctx;
  if (group.kind === "team") return NextResponse.json({ error: "Le groupe d'équipe ne peut pas être supprimé." }, { status: 400 });
  if (!peutAdministrerGroupe(access)) return NextResponse.json({ error: "Réservé aux responsables du groupe." }, { status: 403 });

  const { data: files } = await admin.from("group_messages").select("attachment_path").eq("group_id", group.id).not("attachment_path", "is", null);
  const paths = (files ?? []).map((f) => f.attachment_path as string);
  for (let i = 0; i < paths.length; i += 100) await admin.storage.from("messenger-photos").remove(paths.slice(i, i + 100));

  const { error } = await admin.from("message_groups").delete().eq("id", group.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
