import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";

/** Révoque un taux particulier (la ligne reste, pour la traçabilité). */
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ ecran: "carburant.ticpe_reglages" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const { data, error } = await supabase
    .from("ticpe_rate_overrides")
    .update({ revoked_at: new Date().toISOString(), revoked_by: appUser.id })
    .eq("id", id)
    .is("revoked_at", null)
    .select("id, categorie, zone, date_debut, taux_eur_hl")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Taux introuvable ou déjà révoqué." }, { status: 404 });
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "ticpe_surcharge_revoquee", targetTable: "ticpe_rate_overrides", targetId: id, details: data });
  return NextResponse.json({ ok: true });
}
