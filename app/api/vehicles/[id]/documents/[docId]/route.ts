import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const patchSchema = z.object({
  driverVisible: z.boolean().optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function forbidden() {
  return NextResponse.json({ error: "Réservé à l'exploitation." }, { status: 403 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "direction"])) return forbidden();
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (parsed.data.driverVisible !== undefined) update.driver_visible = parsed.data.driverVisible;
  if (parsed.data.expiresOn !== undefined) update.expires_on = parsed.data.expiresOn;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("vehicle_documents").update(update).eq("id", docId).eq("vehicle_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Removes the row (RLS: manager-like, own organization) then its file. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const g2 = await garderApi({ roles: "tous" });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  if (!hasRole(appUser.role, ["manager", "direction"])) return forbidden();

  const supabase = await createServerSupabaseClient();
  const { data: deleted, error } = await supabase
    .from("vehicle_documents")
    .delete()
    .eq("id", docId)
    .eq("vehicle_id", id)
    .select("file_path")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: "Document introuvable." }, { status: 404 });

  await createAdminSupabaseClient().storage.from("vehicle-documents").remove([deleted.file_path]);
  return NextResponse.json({ ok: true });
}
