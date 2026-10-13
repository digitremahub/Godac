import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { profilSchema } from "@/lib/paie/schemas";

/** Profil de paie d'un salarié (régime, statut, taux horaire, heures, taux PAS). Direction uniquement. */
export async function PUT(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  const { userId } = await params;
  const parsed = profilSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Profil invalide : taux horaire et heures sont obligatoires." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: user } = await supabase.from("users").select("id").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!user) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });
  const { error } = await supabase
    .from("payroll_profiles")
    .upsert({ user_id: userId, organization_id: appUser.organization_id, ...parsed.data, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
