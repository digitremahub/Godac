import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { COLONNES_MODELE_TRANSPORT, profilSchema } from "@/lib/paie/schemas";

/** Profil de paie d'un salarié (régime, statut, taux horaire, heures, taux PAS). Direction uniquement. */
export async function PUT(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const g = await garderApi({ roles: ["direction", "comptable"], modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  const { userId } = await params;
  const parsed = profilSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Profil invalide : taux horaire et heures sont obligatoires." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const { data: user } = await supabase.from("users").select("id").eq("id", userId).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!user) return NextResponse.json({ error: "Salarié introuvable." }, { status: 404 });
  const ligne = { user_id: userId, organization_id: appUser.organization_id, ...parsed.data, updated_at: new Date().toISOString() };
  let { error } = await supabase.from("payroll_profiles").upsert(ligne);
  // Colonnes du modèle transport absentes (migration 20261024000003 pas encore passée) : on enregistre le reste.
  if (error && COLONNES_MODELE_TRANSPORT.profil.some((c) => error!.message.includes(c))) {
    const sans = Object.fromEntries(Object.entries(ligne).filter(([k]) => !(COLONNES_MODELE_TRANSPORT.profil as readonly string[]).includes(k)));
    ({ error } = await supabase.from("payroll_profiles").upsert(sans));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "paie_profil_modifie",
    targetTable: "payroll_profiles",
    targetId: userId,
    details: { salarie: userId, regime: parsed.data.regime, tauxHoraire: parsed.data.hourly_rate, heuresContractuelles: parsed.data.contractual_hours, cadre: parsed.data.is_cadre },
  });
  return NextResponse.json({ ok: true });
}
