import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  totalizer_reading: z.coerce.number().min(0).nullable().optional(),
  note: z.string().nullable().optional(),
  status: z.enum(["pending_review", "reviewed"]).optional(),
});

/**
 * Reading the value off a tank photo and recording it — manager-like
 * within the tank's service, or direction (RLS "tank_photos:
 * manager-like reviews within service" is the real scope check).
 * Deliberately never touches tanks.current_totalizer_index.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour vérifier une photo de cuve" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "reviewed") {
    update.reviewed_by = appUser.id;
    update.reviewed_at = new Date().toISOString();
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("tank_photos").update(update).eq("id", id).select("id").single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tankPhoto: data });
}
