import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { normaliserCode } from "@/lib/stock/mouvements";
import { trouverUniteParCode } from "@/lib/stock/unites-serveur";

const corps = z
  .object({
    /** Unité comptée (code scanné ou saisi). */
    code: z.string().max(400).optional(),
    /** Article compté, avec sa quantité (remplace le comptage précédent de cette ligne). */
    article_id: z.string().uuid().optional(),
    quantite: z.number().min(0).max(1_000_000_000).optional(),
    lot: z.string().max(60).nullable().optional(),
    /** Emplacement où l'unité ou l'article a été trouvé. */
    emplacement_id: z.string().uuid().nullable().optional(),
  })
  .refine((v) => (v.code !== undefined) !== (v.article_id !== undefined), { message: "Un code ou un article." })
  .refine((v) => v.article_id === undefined || v.quantite !== undefined, { message: "Quantité requise." });

/**
 * Enregistre un comptage. Rejouable sans effet double : compter deux fois la même
 * unité, ou ressaisir la même quantité, remplace la ligne. Un compteur peut être
 * un chauffeur ; seule la validation est réservée à l'encadrement.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { id } = await params;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const saisi = parsed.data.code !== undefined ? normaliserCode(parsed.data.code) : null;
  if (parsed.data.code !== undefined && !saisi) return reponseErreur({ code: "stock_requete_invalide", message: "Code invalide.", status: 400 });
  // Le scan d'un code interne complémentaire compte l'unité sous son code principal.
  const code = saisi ? ((await trouverUniteParCode(g.supabase, g.appUser.organization_id, saisi).catch(() => null))?.code ?? saisi) : null;
  const { data, error } = await g.supabase.rpc("stock_compter", {
    p_inventaire: id,
    p_unite_code: code,
    p_article: parsed.data.article_id ?? null,
    p_emplacement: parsed.data.emplacement_id ?? null,
    p_lot: parsed.data.lot ?? null,
    p_quantite: parsed.data.quantite ?? null,
  });
  if (error) return reponseErreur(traduireErreurStock(error));
  return NextResponse.json({ ok: true, ligne_id: (data as { ligne_id?: string } | null)?.ligne_id ?? null });
}
