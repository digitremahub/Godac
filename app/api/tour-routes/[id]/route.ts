import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  tour_number: z.string().trim().min(1).max(60).optional(),
  service_id: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  /** Tournée de renfort : couvre des villages d'autres tournées du service. */
  is_renfort: z.boolean().optional(),
});

async function guard() {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return null;
  return hasRole(g.appUser.role, ["manager", "manager_chauffeur", "direction"]) ? g.appUser : null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Réservé à la direction et aux chefs d'équipe." }, { status: 403 });
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("tour_routes")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await guard())) return NextResponse.json({ error: "Réservé à la direction et aux chefs d'équipe." }, { status: 403 });
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("tour_routes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
