import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parametresEntrepriseSchema } from "@/lib/paie/schemas";

/** Réglages de paie de l'entreprise (effectif, AT, prévoyance, mutuelle, frais). Direction uniquement. */
export async function PUT(req: Request) {
  const g = await garderApi({ roles: ["direction", "comptable"], modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
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
