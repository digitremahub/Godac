import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isModuleEnabled } from "@/lib/organization/modules";
import { membresAutorisesGroupe, peutCreerGroupe } from "@/lib/messenger/groupes";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Service (équipe) du groupe ; null = groupe transversal, réservé à la direction. */
  service_id: z.string().uuid().nullable(),
  member_ids: z.array(z.string().uuid()).max(500),
});

/**
 * « Créer un groupe » : un groupe ponctuel (ex. « Équipe matin ») avec
 * des membres choisis dans l'équipe d'un service. Réservé aux
 * responsables du groupe d'équipe de ce service (chef d'équipe,
 * managers) et à la direction. Le créateur en est responsable.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["messenger"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "messenger"))) {
    return NextResponse.json({ error: "Module Messenger non activé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Nom ou membres invalides." }, { status: 400 });
  const { name, service_id, member_ids } = parsed.data;
  const isDirection = appUser.role === "direction";
  if (!service_id && !isDirection) {
    return NextResponse.json({ error: "Choisissez l'équipe (service) du groupe." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  // Équipe = membres actuels du groupe d'équipe du service (tenu à jour en base).
  let equipe = new Map<string, string>();
  if (service_id) {
    const { data: team } = await admin
      .from("message_groups")
      .select("id, message_group_members(user_id, role)")
      .eq("organization_id", appUser.organization_id)
      .eq("service_id", service_id)
      .eq("kind", "team")
      .maybeSingle();
    if (!team) return NextResponse.json({ error: "Équipe introuvable." }, { status: 404 });
    equipe = new Map(((team.message_group_members ?? []) as { user_id: string; role: string }[]).map((m) => [m.user_id, m.role]));
  }
  const estResponsableEquipe = equipe.get(appUser.id) === "admin";
  if (!peutCreerGroupe(appUser.role, estResponsableEquipe) || (!isDirection && !estResponsableEquipe)) {
    return NextResponse.json({ error: "Seuls le chef d'équipe, les managers de l'équipe et la direction peuvent créer un groupe." }, { status: 403 });
  }

  const { data: actifs } = await admin
    .from("users")
    .select("id")
    .eq("organization_id", appUser.organization_id)
    .eq("active", true)
    .eq("pending_approval", false);
  const actifsOrg = new Set((actifs ?? []).map((u) => u.id as string));
  const membres = membresAutorisesGroupe(member_ids, new Set(equipe.keys()), appUser.role, actifsOrg).filter((id) => id !== appUser.id);
  if (membres.length === 0) return NextResponse.json({ error: "Choisissez au moins un membre." }, { status: 400 });

  const { data: group, error } = await admin
    .from("message_groups")
    .insert({ organization_id: appUser.organization_id, service_id, kind: "custom", name, created_by: appUser.id })
    .select("id")
    .single();
  if (error || !group) return NextResponse.json({ error: error?.message ?? "Création impossible." }, { status: 500 });

  const rows = [
    { group_id: group.id, organization_id: appUser.organization_id, user_id: appUser.id, role: "admin", source: "manual" },
    ...membres.map((id) => ({
      group_id: group.id,
      organization_id: appUser.organization_id,
      user_id: id,
      role: equipe.get(id) === "admin" ? "admin" : "member",
      source: "manual",
    })),
  ];
  const { error: membersError } = await admin.from("message_group_members").insert(rows);
  if (membersError) {
    await admin.from("message_groups").delete().eq("id", group.id);
    return NextResponse.json({ error: membersError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, groupId: group.id });
}
