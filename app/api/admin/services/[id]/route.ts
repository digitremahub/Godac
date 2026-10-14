import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { estPoleBureau } from "@/lib/organization/poles";

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().nullable().optional(),
  // Dépôt propre à ce service — sert de repli le dépôt de
  // l'organisation (organizations.depot_address) pour la
  // classification "🏭 Dépôt" d'un badge pointeuse, le calcul des
  // heures planning/badge de /payroll, et l'estimation de distance
  // "retour direct à domicile" (/tours/history).
  depot_address: z.string().trim().min(1).nullable().optional(),
  // Chef d'équipe du service — affiché à chaque chauffeur rattaché.
  team_leader_name: z.string().trim().max(120).nullable().optional(),
  team_leader_phone: z.string().trim().max(40).nullable().optional(),
  team_leader_email: z.string().trim().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  // Compte GODAC du chef d'équipe (facultatif) : responsable du groupe
  // d'équipe du Messenger, même s'il n'est pas rattaché au service.
  team_leader_user_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les services" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { depot_address, ...fields } = parsed.data;
  const updateFields: Record<string, unknown> = { ...fields };
  if (depot_address !== undefined) {
    const geocoded = depot_address ? await geocodeAddress(depot_address, await codePays(appUser.organization_id)) : null;
    updateFields.depot_address = depot_address;
    updateFields.depot_lat = geocoded?.lat ?? null;
    updateFields.depot_lng = geocoded?.lng ?? null;
  }

  const supabase = await createServerSupabaseClient();
  if (fields.team_leader_user_id) {
    const { data: leader } = await supabase
      .from("users")
      .select("id")
      .eq("id", fields.team_leader_user_id)
      .eq("organization_id", appUser.organization_id)
      .maybeSingle();
    if (!leader) return NextResponse.json({ error: "Compte du chef d'équipe introuvable." }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("services")
    .update(updateFields)
    .eq("id", id)
    .select("id, name, code, pole, depot_address, team_leader_name, team_leader_phone, team_leader_email, team_leader_user_id")
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Un service ou un pôle porte déjà ce nom." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ service: data });
}

/**
 * Vehicles/tanks reference service_id with `on delete set null` — a
 * service with an existing fleet stays deletable, they just become
 * unassigned rather than blocking this action. Les pôles bureau
 * (lib/organization/poles.ts) sont communs à toutes les entreprises :
 * jamais supprimés, seulement renommés.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les services" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: service } = await supabase.from("services").select("pole").eq("id", id).maybeSingle();
  if (service && estPoleBureau(service.pole)) {
    return NextResponse.json({ error: "Les pôles de l'entreprise ne se suppriment pas — vous pouvez les renommer." }, { status: 409 });
  }
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
