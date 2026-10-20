import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";

/** Staff GODAC : révoque une invitation GO Navigation pas encore utilisée. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) {
    return NextResponse.json({ error: "Accès réservé au personnel GODAC" }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invitation introuvable." }, { status: 404 });

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("go_navigation_invitations")
    .update({ revoked_at: new Date().toISOString(), revoked_by_email: user!.email!.toLowerCase() })
    .eq("id", id)
    .is("used_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Révocation impossible." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Invitation déjà utilisée, révoquée ou introuvable." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
