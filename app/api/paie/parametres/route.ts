import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parametresEntrepriseSchema } from "@/lib/paie/schemas";

/** Réglages de paie de l'entreprise (effectif, AT, prévoyance, mutuelle, frais). Direction uniquement. */
export async function PUT(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  const parsed = parametresEntrepriseSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Valeurs invalides." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("payroll_settings")
    .upsert({ organization_id: appUser.organization_id, ...parsed.data, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
