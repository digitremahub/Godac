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

  const ligne = { organization_id: appUser.organization_id, ...parsed.data, updated_by: appUser.id, updated_at: new Date().toISOString() };
  // Sans valeur saisie, on n'envoie pas plafond_litres (la colonne peut encore être « not null » tant que la migration 20261101000001 n'est pas appliquée).
  if (ligne.plafond_litres === null) delete (ligne as { plafond_litres?: number | null }).plafond_litres;
  const upsert = (l: Record<string, unknown>) => supabase.from("ticpe_settings").upsert(l, { onConflict: "organization_id" });
  let { error } = await upsert(ligne);
  // Colonne plafond_actif absente (migration 20261101000001 non appliquée) : sans plafond demandé, on enregistre le reste.
  if (error && estSchemaManquant(error) && !parsed.data.plafond_actif) {
    const { plafond_actif: _a, ...sans } = ligne;
    ({ error } = await upsert(sans));
  }
  if (error) {
    if (estSchemaManquant(error)) {
      return NextResponse.json(
        { error: parsed.data.plafond_actif ? "Plafond indisponible : la migration 20261101000001 n'est pas encore appliquée." : "Réglages indisponibles : la migration 20261031000001 n'est pas encore appliquée." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "ticpe_reglages_modifies", targetTable: "ticpe_settings", targetId: appUser.organization_id, details: parsed.data });
  return NextResponse.json({ ok: true });
}
