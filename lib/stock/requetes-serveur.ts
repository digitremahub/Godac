import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextDay, parisMidnightIso } from "@/lib/utils/paris-time";
import { PAGE_HISTORIQUE, type FiltresHistorique } from "@/lib/stock/historique";
import { calculerEcarts, emplacementsDeLaZone, type BilanInventaire } from "@/lib/stock/inventaire";

/** Colonnes lues pour l'historique (les noms d'emplacements et d'articles viennent des jointures). */
export const COLONNES_MOUVEMENT =
  "id, created_at, type, sens, quantite, unite_code, lot, dlc, statut_avant, statut_apres, motif, source, auteur_nom, run_id, stop_id, article:stock_articles(code, nom, unite), site:stock_sites(nom), src:stock_emplacements!emplacement_source_id(code), dest:stock_emplacements!emplacement_dest_id(code)";

/** Articles dont la référence ou le nom contient le texte (pour filtrer l'historique). */
async function articlesCorrespondants(supabase: SupabaseClient, organizationId: string, q: string): Promise<string[]> {
  const { data } = await supabase.from("stock_articles").select("id").eq("organization_id", organizationId).or(`code.ilike.%${q}%,nom.ilike.%${q}%`).limit(50);
  return ((data ?? []) as { id: string }[]).map((a) => a.id);
}

/**
 * Requête de l'historique (la RLS borne le périmètre : un manager ne voit que ses
 * dépôts). Les deux plus récents d'abord ; `colonnes` et `compter` laissent la
 * page, l'API et l'export partager les mêmes filtres.
 */
export async function requeteMouvements(supabase: SupabaseClient, organizationId: string, f: FiltresHistorique, options: { colonnes?: string; compter?: boolean } = {}) {
  let ids: string[] = [];
  if (f.q) ids = await articlesCorrespondants(supabase, organizationId, f.q);
  let query = supabase
    .from("stock_mouvements")
    .select(options.colonnes ?? COLONNES_MOUVEMENT, options.compter ? { count: "exact" } : undefined)
    .eq("organization_id", organizationId);
  if (f.du) query = query.gte("created_at", parisMidnightIso(f.du));
  if (f.au) query = query.lt("created_at", parisMidnightIso(nextDay(f.au)));
  if (f.type) query = query.eq("type", f.type);
  if (f.site) query = query.eq("site_id", f.site);
  if (f.article) query = query.eq("article_id", f.article);
  if (f.tournee) query = query.eq("run_id", f.tournee);
  if (f.q) query = query.or(ids.length ? `unite_code.ilike.%${f.q}%,article_id.in.(${ids.join(",")})` : `unite_code.ilike.%${f.q}%`);
  // Dans un objet : une fonction async ne doit pas « résoudre » la requête avant ses .range() / .limit().
  return { requete: query.order("created_at", { ascending: false }).order("id", { ascending: false }) };
}

export { PAGE_HISTORIQUE };

export interface InventaireCharge {
  inventaire: {
    id: string;
    site_id: string;
    zone_id: string | null;
    statut: "en_cours" | "valide" | "annule";
    note: string | null;
    created_at: string;
    created_by_nom: string | null;
    validated_at: string | null;
    validated_by_nom: string | null;
    ecarts_total: number | null;
  };
  site: { id: string; nom: string; service_id: string | null } | null;
  zone: { id: string; code: string } | null;
  lignes: { id: string; genre: "unite" | "article"; unite_code: string | null; article_id: string | null; emplacement_id: string | null; lot: string; quantite_comptee: number | null; quantite_theorique: number | null; ecart: number | null }[];
  attendues: { code: string; statut: string; site_id: string | null; emplacement_id: string | null }[];
  articles: { id: string; code: string; nom: string; unite: string }[];
  emplacements: { id: string; site_id: string; parent_id: string | null; genre: "zone" | "emplacement"; type_zone: string | null; code: string; libelle: string | null; actif: boolean }[];
  bilan: BilanInventaire;
}

/**
 * Inventaire, ses lignes, les unités attendues dans son périmètre et l'aperçu des
 * écarts (le même calcul que la validation). La RLS borne la lecture au périmètre.
 */
export async function chargerInventaire(supabase: SupabaseClient, organizationId: string, id: string): Promise<InventaireCharge | null> {
  const { data: inv } = await supabase.from("stock_inventaires").select("id, site_id, zone_id, statut, note, created_at, created_by_nom, validated_at, validated_by_nom, ecarts_total").eq("id", id).eq("organization_id", organizationId).maybeSingle();
  if (!inv) return null;
  const inventaire = inv as InventaireCharge["inventaire"];
  const [{ data: site }, { data: emplacements }, { data: lignes }, { data: unites }, { data: soldes }, { data: articles }] = await Promise.all([
    supabase.from("stock_sites").select("id, nom, service_id").eq("id", inventaire.site_id).maybeSingle(),
    supabase.from("stock_emplacements").select("id, site_id, parent_id, genre, type_zone, code, libelle, actif").eq("organization_id", organizationId).eq("site_id", inventaire.site_id).order("code"),
    supabase.from("stock_inventaire_lignes").select("id, genre, unite_code, article_id, emplacement_id, lot, quantite_comptee, quantite_theorique, ecart").eq("inventaire_id", id).limit(5000),
    supabase.from("stock_unites").select("code, statut, site_id, emplacement_id").eq("organization_id", organizationId).eq("site_id", inventaire.site_id).limit(5000),
    supabase.from("stock_soldes").select("article_id, emplacement_id, lot, quantite").eq("organization_id", organizationId).eq("site_id", inventaire.site_id).limit(5000),
    supabase.from("stock_articles").select("id, code, nom, unite").eq("organization_id", organizationId).limit(5000),
  ]);
  const empl = (emplacements ?? []) as InventaireCharge["emplacements"];
  const ids = inventaire.zone_id ? emplacementsDeLaZone(inventaire.zone_id, empl) : null;
  const lg = ((lignes ?? []) as { quantite_comptee: number | string | null; quantite_theorique: number | string | null; ecart: number | string | null }[]).map((l) => ({
    ...l,
    quantite_comptee: l.quantite_comptee === null ? null : Number(l.quantite_comptee),
    quantite_theorique: l.quantite_theorique === null ? null : Number(l.quantite_theorique),
    ecart: l.ecart === null ? null : Number(l.ecart),
  })) as InventaireCharge["lignes"];
  const connues = (unites ?? []) as InventaireCharge["attendues"];
  const bilan = calculerEcarts({
    perimetre: { site_id: inventaire.site_id, emplacements: ids },
    unitesConnues: connues.map((u) => ({ ...u, statut: u.statut as never })),
    lignesUnites: lg.filter((l) => l.genre === "unite").map((l) => ({ code: l.unite_code!, emplacement_id: l.emplacement_id })),
    lignesArticles: lg.filter((l) => l.genre === "article").map((l) => ({ article_id: l.article_id!, emplacement_id: l.emplacement_id, lot: l.lot, quantite_comptee: l.quantite_comptee })),
    soldes: ((soldes ?? []) as { article_id: string; emplacement_id: string | null; lot: string; quantite: number | string }[]).map((s) => ({ ...s, quantite: Number(s.quantite) })),
  });
  const attendues = connues.filter((u) => u.statut === "dans_depot" && (ids === null || (u.emplacement_id !== null && ids.has(u.emplacement_id))));
  return {
    inventaire,
    site: (site as InventaireCharge["site"]) ?? null,
    zone: inventaire.zone_id ? (empl.find((e) => e.id === inventaire.zone_id) ? { id: inventaire.zone_id, code: empl.find((e) => e.id === inventaire.zone_id)!.code } : null) : null,
    lignes: lg,
    attendues,
    articles: (articles ?? []) as InventaireCharge["articles"],
    emplacements: empl,
    bilan,
  };
}
