import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK } from "@/lib/acces/catalogue";
import { journaliser } from "@/lib/audit/journal";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { PAGE_HISTORIQUE, lireFiltresHistorique, ligneHistorique, type MouvementBrut } from "@/lib/stock/historique";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { schemaMouvement, validerMouvement } from "@/lib/stock/mouvements";
import { requeteMouvements } from "@/lib/stock/requetes-serveur";
import { appelerMouvement, lireParametresStock } from "@/lib/stock/serveur";
import { trouverUniteParCode } from "@/lib/stock/unites-serveur";
import { reevaluerSeuils } from "@/lib/stock/alertes-serveur";

/** Historique des mouvements (filtres : du, au, type, q, site, article, tournee, page). Le registre est en lecture seule. */
export async function GET(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const f = lireFiltresHistorique(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const { codesInstalles } = await lireParametresStock(supabase, appUser.organization_id);
  const { requete } = await requeteMouvements(supabase, appUser.organization_id, f, { compter: true, codesInstalles });
  const { data, error, count } = await requete.range((f.page - 1) * PAGE_HISTORIQUE, f.page * PAGE_HISTORIQUE - 1);
  if (error) return reponseErreur(traduireErreurStock(error));
  return NextResponse.json({ mouvements: ((data ?? []) as unknown as MouvementBrut[]).map(ligneHistorique), total: count ?? 0, page: f.page, parPage: PAGE_HISTORIQUE });
}

/**
 * Enregistre un mouvement (entrée, sortie, transfert, retour, casse, perte, ajustement).
 * Tout passe par la fonction SQL stock_enregistrer_mouvement (une transaction : registre + solde ou unité).
 * La clé d'idempotence du corps (`cle`) rend l'appel rejouable sans effet double (file hors ligne, double appui).
 * Chauffeur, manager (ses services), exploitation, direction ; l'ajustement est refusé au chauffeur.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = schemaMouvement.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const { supabase, appUser } = g;
  const { profils, config } = await lireParametresStock(supabase, appUser.organization_id);
  // Unité déjà connue (code principal ou code interne) : ses valeurs comptent pour les champs obligatoires.
  const existante = parsed.data.code ? await trouverUniteParCode(supabase, appUser.organization_id, parsed.data.code).catch(() => null) : null;
  const v = validerMouvement(parsed.data, { profils, role: appUser.role, config, uniteExistante: existante });
  if (!v.ok) return reponseErreur({ code: "stock_requete_invalide", message: v.erreur, status: 400 });
  const r = await appelerMouvement(supabase, v.params);
  if (!r.ok) return reponseErreur(r);
  if (!r.doublon) {
    if (v.params.p_type === "ajustement") {
      await journaliser({
        organizationId: appUser.organization_id,
        userId: appUser.id,
        action: "stock_ajustement",
        targetTable: "stock_mouvements",
        targetId: r.mouvementId,
        details: { sens: v.params.p_sens, quantite: v.params.p_quantite, code: v.params.p_unite_code, article_id: v.params.p_article, motif: v.params.p_motif },
      });
    }
    // Un retrait d'article peut faire passer sous le seuil mini : alertes réévaluées (non bloquant).
    if (v.params.p_article && (v.params.p_type === "sortie" || v.params.p_type === "casse" || v.params.p_type === "perte" || v.params.p_type === "transfert" || v.params.p_sens === -1)) {
      await reevaluerSeuils(appUser.organization_id);
    }
  }
  return NextResponse.json({ ok: true, doublon: r.doublon, mouvement_id: r.mouvementId, unite_id: r.uniteId, statut: r.statut, quantite_apres: r.quantiteApres, code: r.code, code_interne: r.codeInterne });
}
