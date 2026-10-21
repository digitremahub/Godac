import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { COLONNES_ARRETS_SORTIES, COLONNES_MODELE_TRANSPORT, parametresEntrepriseSchema } from "@/lib/paie/schemas";

/** Réglages de paie de l'entreprise (effectif, AT, prévoyance, mutuelle, frais). Direction uniquement. */
export async function PUT(req: Request) {
  const g = await garderApi({ roles: ["direction", "comptable"], modules: ["payslips"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") return NextResponse.json({ error: "Réservé à la direction." }, { status: 403 });
  const parsed = parametresEntrepriseSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Valeurs invalides." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const ligne = { organization_id: appUser.organization_id, ...parsed.data, updated_at: new Date().toISOString() };
  let { error } = await supabase.from("payroll_settings").upsert(ligne);
  // Colonnes du maintien de salaire absentes (migration 20261026000002 pas encore passée) : on enregistre le reste.
  if (error && COLONNES_ARRETS_SORTIES.reglages.some((c) => error!.message.includes(c))) {
    const colonnes = COLONNES_ARRETS_SORTIES.reglages as readonly string[];
    for (const k of colonnes) delete (ligne as Record<string, unknown>)[k];
    ({ error } = await supabase.from("payroll_settings").upsert(ligne));
  }
  // Colonnes du modèle transport absentes (migration 20261024000003 pas encore passée) : on enregistre le reste.
  if (error && COLONNES_MODELE_TRANSPORT.reglages.some((c) => error!.message.includes(c))) {
    const sans = Object.fromEntries(Object.entries(ligne).filter(([k]) => !(COLONNES_MODELE_TRANSPORT.reglages as readonly string[]).includes(k)));
    ({ error } = await supabase.from("payroll_settings").upsert(sans));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
