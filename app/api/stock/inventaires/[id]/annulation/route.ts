import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { ENCADREMENT } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";

/**
 * Abandonne un inventaire en cours (aucun mouvement n'est créé ; les comptages restent consultables).
 * Manager de ses services, exploitation, direction. Rejouable. Journalisé.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: ENCADREMENT, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return reponseErreur(REQUETE_INVALIDE);
  const { data, error } = await g.supabase.rpc("stock_annuler_inventaire", { p_inventaire: id });
  if (error) return reponseErreur(traduireErreurStock(error));
  const r = (data ?? {}) as { doublon?: boolean };
  if (!r.doublon) await journaliser({ organizationId: g.appUser.organization_id, userId: g.appUser.id, action: "stock_inventaire_annule", targetTable: "stock_inventaires", targetId: id });
  return NextResponse.json({ ok: true, doublon: Boolean(r.doublon) });
}
