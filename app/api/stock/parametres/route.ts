import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK, PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { PROFILS, normaliserProfils } from "@/lib/stock/profils";
import { lireParametresStock } from "@/lib/stock/serveur";

/** Profils d'activité activés pour l'organisation (messagerie, palettes, vrac). */
export async function GET() {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  return NextResponse.json(await lireParametresStock(g.supabase, g.appUser.organization_id));
}

const corps = z.object({ profils: z.array(z.enum(PROFILS)).max(PROFILS.length) });

/**
 * Active ou désactive des profils. Désactiver un profil ne supprime rien : les
 * unités et articles restent consultables, seuls les nouveaux mouvements de ce
 * profil sont refusés. Journalisé (avant / après).
 */
export async function PUT(req: Request) {
  const g = await garderApi({ roles: PARAMETREURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const { appUser, supabase } = g;
  const avant = await lireParametresStock(supabase, appUser.organization_id);
  const profils = normaliserProfils(parsed.data.profils);
  const { error } = await supabase.from("stock_parametres").upsert({ organization_id: appUser.organization_id, profils, updated_by: appUser.id, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
  if (error) return reponseErreur(traduireErreurStock(error));
  await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "stock_profils_modifies", targetTable: "stock_parametres", targetId: appUser.organization_id, details: { avant: avant.profils, apres: profils } });
  return NextResponse.json({ profils, schemaAbsent: false });
}
