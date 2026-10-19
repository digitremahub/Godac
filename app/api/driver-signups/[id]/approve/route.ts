import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { canManagePendingDriver } from "@/lib/auth/driver-signup-scope";

/**
 * users RLS only lets direction write (see "users: direction manages
 * members"), but a chef de service/responsable exploitation should be
 * able to approve their own team without going through direction —
 * so this validates scope in app code (canManagePendingDriver) and
 * writes via the service-role client, same pattern as
 * app/api/support-requests/[id]/route.ts.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
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
  const { error } = await admin.from("users").update({ pending_approval: false, active: true }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
