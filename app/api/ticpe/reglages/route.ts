import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { journaliser } from "@/lib/audit/journal";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { schemaReglages } from "@/lib/ticpe/reglages";

/**
 * Enregistre les réglages TICPE de l'organisation (direction, comptable).
 * RLS « ticpe_settings » : même règle en base.
 */
export async function PUT(req: Request) {
  const g = await garderApi({ ecran: "carburant.ticpe_reglages" });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const parsed = schemaReglages.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Réglages invalides." }, { status: 400 });

  const { error } = await supabase
    .from("ticpe_settings")
    .upsert({ organization_id: appUser.organization_id, ...parsed.data, updated_by: appUser.id, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error) {
    if (estSchemaManquant(error)) return NextResponse.json({ error: "Réglages indisponibles : la migration 20261031000001 n'est pas encore appliquée." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "ticpe_reglages_modifies", targetTable: "ticpe_settings", targetId: appUser.organization_id, details: parsed.data });
  return NextResponse.json({ ok: true });
}
