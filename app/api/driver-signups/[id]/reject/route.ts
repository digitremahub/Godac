import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManagePendingDriver } from "@/lib/auth/driver-signup-scope";

/**
 * Hard-deletes a rejected self-signup — safe only because a pending
 * account has no history yet (unlike an approved-then-deactivated
 * driver, which fuel_entries.driver_id's `on delete restrict` would
 * block anyway). Same scope check as .../approve.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: target } = await supabase
    .from("users")
    .select("id, organization_id, pending_approval")
    .eq("id", id)
    .maybeSingle();
  if (!target || target.organization_id !== appUser.organization_id || !target.pending_approval) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }

  if (!(await canManagePendingDriver(supabase, appUser, id))) {
    return NextResponse.json({ error: "Ce chauffeur a choisi un autre service que le vôtre." }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();
  const { error: deleteRowError } = await admin.from("users").delete().eq("id", id);
  if (deleteRowError) return NextResponse.json({ error: deleteRowError.message }, { status: 500 });
  await admin.auth.admin.deleteUser(id);

  return NextResponse.json({ ok: true });
}
