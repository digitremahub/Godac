import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().nullable().optional(),
  // Dépôt propre à ce service — sert de repli le dépôt de
  // l'organisation (organizations.depot_address) pour la
  // classification "🏭 Dépôt" d'un badge pointeuse, le calcul des
  // heures planning/badge de /payroll, et l'estimation de distance
  // "retour direct à domicile" (/tours/history).
  depot_address: z.string().trim().min(1).nullable().optional(),
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
    const geocoded = depot_address ? await geocodeAddress(depot_address) : null;
    updateFields.depot_address = depot_address;
    updateFields.depot_lat = geocoded?.lat ?? null;
    updateFields.depot_lng = geocoded?.lng ?? null;
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("services")
    .update(updateFields)
    .eq("id", id)
    .select("id, name, code, depot_address")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ service: data });
}

/**
 * Vehicles/tanks reference service_id with `on delete set null` — a
 * service with an existing fleet stays deletable, they just become
 * unassigned rather than blocking this action.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour gérer les services" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("services").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
