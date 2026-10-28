import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { grouperNonRentrees, type TourneeNonRentree } from "@/lib/stock/alertes";
import type { EmplacementLu } from "@/lib/stock/emplacements";
import { articlesSousSeuil, resumerComptes, type ArticleSousSeuil, type ResumeUnites, type Solde } from "@/lib/stock/soldes";
import { STATUTS_UNITE } from "@/lib/stock/transitions";

/** Lectures partagées par les pages et les routes du stock (la RLS borne le périmètre de service). */

export interface SiteLu {
  id: string;
  nom: string;
  adresse: string | null;
  service_id: string | null;
  actif: boolean;
}

export interface ArticleLu {
  id: string;
  activite: string;
  code: string;
  nom: string;
  unite: string;
  seuil_mini: number;
  suivi_lots: boolean;
  suivi_dlc: boolean;
  actif: boolean;
}

export interface ArticleAvecQuantite extends ArticleLu {
  quantite: number;
  sous_seuil: boolean;
}

export interface Referentiel {
  sites: SiteLu[];
  emplacements: EmplacementLu[];
  articles: ArticleLu[];
}

const COLONNES_ARTICLE = "id, activite, code, nom, unite, seuil_mini, suivi_lots, suivi_dlc, actif";

/** Dépôts, zones et emplacements, articles : de quoi remplir les listes déroulantes. */
export async function chargerReferentiel(supabase: SupabaseClient, organizationId: string): Promise<Referentiel> {
  const [sites, emplacements, articles] = await Promise.all([
    supabase.from("stock_sites").select("id, nom, adresse, service_id, actif").eq("organization_id", organizationId).order("nom"),
    supabase.from("stock_emplacements").select("id, site_id, parent_id, genre, type_zone, code, libelle, actif").eq("organization_id", organizationId).order("code").limit(5000),
    supabase.from("stock_articles").select(COLONNES_ARTICLE).eq("organization_id", organizationId).order("nom").limit(5000),
  ]);
  return {
    sites: (sites.data ?? []) as SiteLu[],
    emplacements: (emplacements.data ?? []) as EmplacementLu[],
    articles: ((articles.data ?? []) as (Omit<ArticleLu, "seuil_mini"> & { seuil_mini: number | string })[]).map((a) => ({ ...a, seuil_mini: Number(a.seuil_mini) })),
  };
}

/** Tous les soldes de l'organisation (dans le périmètre de la RLS), page par page. */
export async function lireSoldes(supabase: SupabaseClient, organizationId: string): Promise<{ soldes: Solde[]; erreur: string | null }> {
  const lus = await fetchAllRows<{ article_id: string; site_id: string; emplacement_id: string | null; lot: string; dlc: string | null; quantite: number | string }>(
    (a, b) => supabase.from("stock_soldes").select("article_id, site_id, emplacement_id, lot, dlc, quantite").eq("organization_id", organizationId).order("id").range(a, b) as unknown as PromiseLike<{ data: never[] | null; error: { message: string } | null }>,
  );
  return { soldes: lus.rows.map((s) => ({ ...s, quantite: Number(s.quantite) })), erreur: lus.error };
}

/** Articles avec leur quantité totale et leur situation face au seuil. */
export function avecQuantites(articles: readonly ArticleLu[], soldes: readonly Solde[]): ArticleAvecQuantite[] {
  const sous = new Set(articlesSousSeuil(articles, soldes).map((x) => x.article.id));
  return articles.map((a) => ({ ...a, quantite: soldes.filter((s) => s.article_id === a.id).reduce((n, s) => n + s.quantite, 0), sous_seuil: sous.has(a.id) }));
}

export interface TableauDeBord {
  unites: ResumeUnites;
  sousSeuil: ArticleSousSeuil[];
  nonRentrees: TourneeNonRentree[];
  nbArticles: number;
}

/** Chiffres du tableau de bord : en dépôt, en tournée, retours, alertes de seuil, unités non rentrées. */
export async function chargerTableauDeBord(supabase: SupabaseClient, organizationId: string, referentiel: Referentiel): Promise<TableauDeBord> {
  const comptes = await Promise.all(
    STATUTS_UNITE.map(async (statut) => {
      const { count } = await supabase.from("stock_unites").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("statut", statut);
      return { statut, n: count ?? 0 };
    }),
  );
  const unites = resumerComptes(Object.fromEntries(comptes.map(({ statut, n }) => [statut, n])));
  const { soldes } = await lireSoldes(supabase, organizationId);
  const sousSeuil = articlesSousSeuil(referentiel.articles, soldes);

  // Unités encore chargées sur une tournée clôturée (un retour déjà rangé est rentré).
  const { data: enTournee } = await supabase
    .from("stock_unites")
    .select("run_id, statut, emplacement_id")
    .eq("organization_id", organizationId)
    .not("run_id", "is", null)
    .in("statut", ["en_tournee", "retour"])
    .limit(2000);
  const aRentrer = ((enTournee ?? []) as { run_id: string | null; statut: string; emplacement_id: string | null }[]).filter((u) => u.statut === "en_tournee" || u.emplacement_id === null);
  const runIds = [...new Set(aRentrer.map((u) => u.run_id).filter((x): x is string => Boolean(x)))].slice(0, 200);
  const tournees = new Map<string, { libelle: string; service_id: string | null; cloturee: boolean }>();
  if (runIds.length) {
    const { data: runs } = await supabase.from("delivery_runs").select("id, name, run_date, status, service_id").eq("organization_id", organizationId).in("id", runIds);
    for (const r of (runs ?? []) as { id: string; name: string | null; run_date: string; status: string; service_id: string | null }[]) {
      tournees.set(r.id, { libelle: `${r.name ?? "sans nom"} du ${r.run_date.split("-").reverse().join("/")}`, service_id: r.service_id, cloturee: r.status === "done" });
    }
  }
  return { unites, sousSeuil, nonRentrees: grouperNonRentrees(aRentrer, tournees), nbArticles: referentiel.articles.filter((a) => a.actif).length };
}
