import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  villages: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        postal_code: z.string().trim().max(10).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .max(200),
});

/** Replaces a tour's ordered village list in one go — the editor saves the whole list. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Réservé à la direction et aux chefs d'équipe." }, { status: 403 });
  }
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Chaque village doit avoir un nom." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: route } = await supabase.from("tour_routes").select("id").eq("id", id).maybeSingle();
  if (!route) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  const { error: deleteError } = await supabase.from("tour_route_villages").delete().eq("route_id", id);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  if (parsed.data.villages.length > 0) {
    const { error } = await supabase.from("tour_route_villages").insert(
      parsed.data.villages.map((v, i) => ({
        organization_id: appUser.organization_id,
        route_id: id,
        position: i,
        name: v.name,
        postal_code: v.postal_code || null,
        notes: v.notes || null,
      })),
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await supabase.from("tour_routes").update({ updated_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
