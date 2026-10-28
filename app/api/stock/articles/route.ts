import { NextResponse } from "next/server";
import { z } from "zod";
import { garderApi } from "@/lib/acces/garde-api";
import { LECTEURS_STOCK, PARAMETREURS_STOCK } from "@/lib/acces/catalogue";
import { traduireErreurStock } from "@/lib/stock/erreurs";
import { lireCorps, reponseErreur, REQUETE_INVALIDE } from "@/lib/stock/http";
import { PROFILS, UNITES_ARTICLE, avecArticles, profilsArticles, resoudreProfil } from "@/lib/stock/profils";
import { lireParametresStock } from "@/lib/stock/serveur";
import { avecQuantites, lireSoldes, type ArticleLu } from "@/lib/stock/chargement-serveur";

const COLONNES = "id, activite, code, nom, unite, seuil_mini, suivi_lots, suivi_dlc, actif";
const COLONNES_PROFIL = `${COLONNES}, profil`;

/** Articles avec leur quantité totale et leur situation face au seuil (`?q=` référence ou nom, `?sous_seuil=1`, `?inactifs=1`). */
export async function GET(req: Request) {
  const g = await garderApi({ roles: LECTEURS_STOCK, modules: ["stock"] });
  if (!g.ok) return g.reponse;
  const { supabase, appUser } = g;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().replace(/[%_,()*]/g, " ").slice(0, 60);
  const { codesInstalles } = await lireParametresStock(supabase, appUser.organization_id);
  let query = supabase.from("stock_articles").select(codesInstalles ? COLONNES_PROFIL : COLONNES).eq("organization_id", appUser.organization_id).order("nom").limit(500);
  if (url.searchParams.get("inactifs") !== "1") query = query.eq("actif", true);
  if (q) query = query.or(`code.ilike.%${q}%,nom.ilike.%${q}%`);
  const [articles, lus] = await Promise.all([query, lireSoldes(supabase, appUser.organization_id)]);
  if (articles.error) return reponseErreur(traduireErreurStock(articles.error));
  if (lus.erreur) return reponseErreur({ code: "stock_erreur", message: "Lecture des quantités impossible.", status: 500 });
  const liste = ((articles.data ?? []) as unknown as (Omit<ArticleLu, "seuil_mini"> & { seuil_mini: number | string })[]).map((a) => ({ ...a, seuil_mini: Number(a.seuil_mini) }));
  let lignes = avecQuantites(liste, lus.soldes);
  if (url.searchParams.get("sous_seuil") === "1") lignes = lignes.filter((l) => l.sous_seuil);
  return NextResponse.json({ articles: lignes });
}

const corps = z.object({
  /** Profil d'activité de l'article (alimentaire, pharmacie, vrac…) : règles de DLC, FEFO, champs obligatoires. */
  profil: z.enum(PROFILS).optional(),
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
  const { profils, config, codesInstalles } = await lireParametresStock(supabase, appUser.organization_id);
  if (!avecArticles(profils, config)) return reponseErreur({ code: "stock_profil_inactif", message: "Activez d'abord un profil de références (références en vrac, alimentaire, médicaments et pharmacie…) dans les paramètres.", status: 409 });
  const { profil, ...reste } = parsed.data;
  if (profil && !profilsArticles(profils, config).includes(profil)) return reponseErreur({ code: "stock_profil_inactif", message: "Ce profil n'est pas activé pour les articles.", status: 409 });
  // Un profil qui impose le lot ou la DLC les active d'office sur l'article.
  const p = profil ? resoudreProfil(profil, config) : null;
  const ligne = {
    organization_id: appUser.organization_id,
    ...reste,
    activite: "vrac",
    suivi_lots: reste.suivi_lots || p?.champs.lot === "requis",
    suivi_dlc: reste.suivi_dlc || p?.champs.dlc === "requis",
    seuil_mini: Math.round(reste.seuil_mini * 1000) / 1000,
    ...(profil && codesInstalles ? { profil } : {}),
  };
  const { data, error } = await supabase.from("stock_articles").insert(ligne).select(profil && codesInstalles ? COLONNES_PROFIL : COLONNES).single();
  if (error) {
    const e = traduireErreurStock(error);
    return reponseErreur(e.code === "stock_doublon" ? { ...e, message: "Cette référence existe déjà." } : e);
  }
  return NextResponse.json({ article: data }, { status: 201 });
}
