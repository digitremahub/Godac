import { STATUTS_AU_DEPOT, type StatutUnite, type TypeMouvement } from "@/lib/stock/transitions";

/**
 * Soldes des articles et tableau de bord (fichier pur). `appliquerMouvement`
 * reproduit la logique de public.stock__appliquer pour les articles : pas de
 * stock négatif, un solde par (article, dépôt, emplacement, lot), le registre
 * ne change jamais. Testé dans lib/stock/__tests__/soldes.test.ts.
 */

export interface Solde {
  article_id: string;
  site_id: string;
  emplacement_id: string | null;
  lot: string;
  dlc?: string | null;
  quantite: number;
}

export interface MouvementArticle {
  type: TypeMouvement;
  /** Seulement pour un ajustement : +1 ou -1. */
  sens?: number | null;
  article_id: string;
  site_id: string;
  quantite: number;
  emplacement_source_id?: string | null;
  emplacement_dest_id?: string | null;
  lot?: string | null;
  dlc?: string | null;
}

export type ResultatSoldes = { ok: true; soldes: Solde[] } | { ok: false; erreur: "stock_insuffisant" | "stock_quantite_invalide" | "stock_transfert_identique" | "stock_sens_invalide" };

const cle = (s: { article_id: string; site_id: string; emplacement_id: string | null; lot: string }) => `${s.article_id}|${s.site_id}|${s.emplacement_id ?? "-"}|${s.lot}`;
const arrondi = (n: number) => Math.round(n * 1000) / 1000 + 0; // « + 0 » : jamais -0

/** Applique un mouvement d'article à une liste de soldes ; ne modifie pas la liste reçue. */
export function appliquerMouvement(soldes: readonly Solde[], m: MouvementArticle): ResultatSoldes {
  if (!(m.quantite > 0)) return { ok: false, erreur: "stock_quantite_invalide" };
  const lot = (m.lot ?? "").trim();
  const sens = m.type === "entree" || m.type === "retour" ? 1 : m.type === "sortie" || m.type === "casse" || m.type === "perte" ? -1 : m.type === "transfert" ? 0 : (m.sens ?? 0);
  if (m.type === "ajustement" && sens !== 1 && sens !== -1) return { ok: false, erreur: "stock_sens_invalide" };
  const src = m.emplacement_source_id ?? null;
  const dest = m.emplacement_dest_id ?? null;
  if (m.type === "transfert" && src === dest) return { ok: false, erreur: "stock_transfert_identique" };
  const copie = new Map(soldes.map((s) => [cle(s), { ...s }]));
  let dlc = m.dlc ?? null;

  if (sens < 0 || m.type === "transfert") {
    const k = cle({ article_id: m.article_id, site_id: m.site_id, emplacement_id: src, lot });
    const s = copie.get(k);
    if (!s || s.quantite < m.quantite) return { ok: false, erreur: "stock_insuffisant" };
    s.quantite = arrondi(s.quantite - m.quantite);
    dlc = s.dlc ?? dlc;
  }
  if (sens > 0 || m.type === "transfert") {
    const k = cle({ article_id: m.article_id, site_id: m.site_id, emplacement_id: dest, lot });
    const s = copie.get(k);
    if (s) {
      s.quantite = arrondi(s.quantite + m.quantite);
      s.dlc = dlc ?? s.dlc ?? null;
    } else {
      copie.set(k, { article_id: m.article_id, site_id: m.site_id, emplacement_id: dest, lot, dlc, quantite: arrondi(m.quantite) });
    }
  }
  return { ok: true, soldes: [...copie.values()] };
}

/** Quantité totale d'un article, tous dépôts, emplacements et lots confondus. */
export function totalArticle(soldes: readonly Solde[], articleId: string): number {
  return arrondi(soldes.filter((s) => s.article_id === articleId).reduce((n, s) => n + s.quantite, 0));
}

export interface ArticleSeuil {
  id: string;
  code: string;
  nom: string;
  unite: string;
  seuil_mini: number;
  actif: boolean;
}

export interface ArticleSousSeuil {
  article: ArticleSeuil;
  quantite: number;
  manque: number;
}

/**
 * Articles actifs sous leur seuil mini (seuil > 0 et quantité strictement
 * inférieure), les plus en manque d'abord.
 */
export function articlesSousSeuil(articles: readonly ArticleSeuil[], soldes: readonly Solde[]): ArticleSousSeuil[] {
  const totaux = new Map<string, number>();
  for (const s of soldes) totaux.set(s.article_id, (totaux.get(s.article_id) ?? 0) + s.quantite);
  return articles
    .filter((a) => a.actif && a.seuil_mini > 0)
    .map((a) => {
      const quantite = arrondi(totaux.get(a.id) ?? 0);
      return { article: a, quantite, manque: arrondi(a.seuil_mini - quantite) };
    })
    .filter((x) => x.quantite < x.article.seuil_mini)
    .sort((a, b) => b.manque - a.manque || a.article.nom.localeCompare(b.article.nom, "fr"));
}

export interface ResumeUnites {
  dansDepot: number;
  enTournee: number;
  retours: number;
  livres: number;
  perdus: number;
  endommages: number;
  /** Physiquement au dépôt : en stock + retours à ranger. */
  auDepot: number;
}

/** Dénombrement à partir d'effectifs par statut (tableau de bord : un comptage par statut en base). */
export function resumerComptes(c: Partial<Record<StatutUnite, number>>): ResumeUnites {
  const n = (s: StatutUnite) => c[s] ?? 0;
  return {
    dansDepot: n("dans_depot"),
    enTournee: n("en_tournee"),
    retours: n("retour"),
    livres: n("livre"),
    perdus: n("perdu"),
    endommages: n("endommage"),
    auDepot: STATUTS_AU_DEPOT.reduce((t, s) => t + n(s), 0),
  };
}

/** Dénombrement des unités par statut. */
export function resumerUnites(unites: readonly { statut: StatutUnite }[]): ResumeUnites {
  const c: Partial<Record<StatutUnite, number>> = {};
  for (const u of unites) c[u.statut] = (c[u.statut] ?? 0) + 1;
  return resumerComptes(c);
}

/** Jours avant une DLC (négatif : dépassée), ou null. `aujourdhui` au format AAAA-MM-JJ. */
export function joursAvantDlc(dlc: string | null | undefined, aujourdhui: string): number | null {
  if (!dlc) return null;
  const a = Date.parse(`${dlc}T00:00:00Z`);
  const b = Date.parse(`${aujourdhui}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** Quantité formatée à la française, sans zéros inutiles (12 ; 12,5). */
export function formaterQuantite(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(n);
}
