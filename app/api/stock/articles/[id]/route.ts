import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { UNITES_ARTICLE } from "@/lib/stock/profils";
import { reevaluerSeuils } from "@/lib/stock/alertes-serveur";

const corps = z
  .object({
    nom: z.string().trim().min(1).max(120).optional(),
    unite: z.enum(UNITES_ARTICLE).optional(),
    seuil_mini: z.number().min(0).max(1_000_000_000).optional(),
    suivi_lots: z.boolean().optional(),
    suivi_dlc: z.boolean().optional(),
    /** Suppression logique : false désactive l'article (son historique et ses soldes restent). */
    actif: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: PARAMETREURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { id } = await params;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const { supabase, appUser } = g;
  const { data: avant } = await supabase.from("stock_articles").select("code, nom, seuil_mini, actif").eq("id", id).eq("organization_id", appUser.organization_id).maybeSingle();
  if (!avant) return reponseErreur({ code: "stock_article_invalide", message: "Article introuvable.", status: 404 });
  const maj = { ...parsed.data, ...(parsed.data.seuil_mini !== undefined ? { seuil_mini: Math.round(parsed.data.seuil_mini * 1000) / 1000 } : {}), updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("stock_articles").update(maj).eq("id", id).eq("organization_id", appUser.organization_id).select("id, activite, code, nom, unite, seuil_mini, suivi_lots, suivi_dlc, actif").maybeSingle();
  if (error) return reponseErreur(traduireErreurStock(error));
  if (!data) return reponseErreur({ code: "stock_article_invalide", message: "Article introuvable.", status: 404 });
  if (parsed.data.seuil_mini !== undefined && Number(avant.seuil_mini) !== Number(data.seuil_mini)) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "stock_seuil_modifie", targetTable: "stock_articles", targetId: id, details: { code: avant.code, avant: Number(avant.seuil_mini), apres: Number(data.seuil_mini) } });
  }
  if (parsed.data.actif !== undefined && parsed.data.actif !== avant.actif) {
    await journaliser({ organizationId: appUser.organization_id, userId: appUser.id, action: "stock_archivage", targetTable: "stock_articles", targetId: id, details: { objet: "article", code: avant.code, actif: parsed.data.actif } });
  }
  // Un seuil ou une désactivation change les alertes : réévaluées tout de suite (non bloquant).
  if (parsed.data.seuil_mini !== undefined || parsed.data.actif !== undefined) await reevaluerSeuils(appUser.organization_id);
  return NextResponse.json({ article: data });
}
