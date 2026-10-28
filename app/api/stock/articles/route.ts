import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK, PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { PROFILS, UNITES_ARTICLE, avecArticles } from "@/lib/stock/profils";
import { lireParametresStock } from "@/lib/stock/serveur";
import { articlesSousSeuil, type Solde } from "@/lib/stock/soldes";
import { fetchAllRows } from "@/lib/utils/fetch-all";

const COLONNES = "id, activite, code, nom, unite, seuil_mini, suivi_lots, suivi_dlc, actif";

/** Articles avec leur quantité totale et leur situation face au seuil (`?q=` référence ou nom, `?sous_seuil=1`, `?inactifs=1`). */
export async function GET(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().replace(/[%_,()*]/g, " ").slice(0, 60);
  let query = supabase.from("stock_articles").select(COLONNES).eq("organization_id", appUser.organization_id).order("nom").limit(500);
  if (url.searchParams.get("inactifs") !== "1") query = query.eq("actif", true);
  if (q) query = query.or(`code.ilike.%${q}%,nom.ilike.%${q}%`);
  const [articles, soldesLus] = await Promise.all([
    query,
    fetchAllRows<{ article_id: string; site_id: string; emplacement_id: string | null; lot: string; dlc: string | null; quantite: number | string }>(
      (a, b) => supabase.from("stock_soldes").select("article_id, site_id, emplacement_id, lot, dlc, quantite").eq("organization_id", appUser.organization_id).order("id").range(a, b) as unknown as PromiseLike<{ data: never[] | null; error: { message: string } | null }>,
    ),
  ]);
  if (articles.error) return reponseErreur(traduireErreurStock(articles.error));
  if (soldesLus.error) return reponseErreur({ code: "stock_erreur", message: "Lecture des quantités impossible.", status: 500 });
  const soldes: Solde[] = soldesLus.rows.map((s) => ({ ...s, quantite: Number(s.quantite) }));
  const liste = ((articles.data ?? []) as unknown as { id: string; code: string; nom: string; unite: string; seuil_mini: number | string; actif: boolean }[]).map((a) => ({ ...a, seuil_mini: Number(a.seuil_mini) }));
  const sous = new Map(articlesSousSeuil(liste, soldes).map((x) => [x.article.id, x]));
  let lignes = liste.map((a) => ({ ...a, quantite: soldes.filter((s) => s.article_id === a.id).reduce((n, s) => n + s.quantite, 0), sous_seuil: sous.has(a.id) }));
  if (url.searchParams.get("sous_seuil") === "1") lignes = lignes.filter((l) => l.sous_seuil);
  return NextResponse.json({ articles: lignes });
}

const corps = z.object({
  activite: z.enum(PROFILS).default("vrac"),
  code: z.string().trim().min(1).max(60),
  nom: z.string().trim().min(1).max(120),
  unite: z.enum(UNITES_ARTICLE).default("piece"),
  seuil_mini: z.number().min(0).max(1_000_000_000).default(0),
  suivi_lots: z.boolean().default(false),
  suivi_dlc: z.boolean().default(false),
});

export async function POST(req: Request) {
  const g = await garderApi({ roles: PARAMETREURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const parsed = corps.safeParse(await lireCorps(req));
  if (!parsed.success) return reponseErreur(REQUETE_INVALIDE);
  const { supabase, appUser } = g;
  const { profils } = await lireParametresStock(supabase, appUser.organization_id);
  if (!avecArticles(profils)) return reponseErreur({ code: "stock_profil_inactif", message: "Activez d'abord le profil « Marchandises en vrac / références » dans les paramètres.", status: 409 });
  const { data, error } = await supabase
    .from("stock_articles")
    .insert({ organization_id: appUser.organization_id, ...parsed.data, seuil_mini: Math.round(parsed.data.seuil_mini * 1000) / 1000 })
    .select(COLONNES)
    .single();
  if (error) {
    const e = traduireErreurStock(error);
    return reponseErreur(e.code === "stock_doublon" ? { ...e, message: "Cette référence existe déjà." } : e);
  }
  return NextResponse.json({ article: data }, { status: 201 });
}
