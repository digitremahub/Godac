/**
 * Écarts d'un inventaire (fichier pur). Reproduit la logique de
 * public.stock_valider_inventaire : unités comptées conformes, déplacées,
 * retrouvées hors stock, attendues mais non comptées (perdues) ; articles comptés
 * face au solde du moment. Testé dans lib/stock/__tests__/inventaire.test.ts.
 */
import type { StatutUnite } from "@/lib/stock/transitions";

export interface UniteConnue {
  code: string;
  statut: StatutUnite;
  site_id: string | null;
  emplacement_id: string | null;
}

export interface LigneUnite {
  code: string;
  emplacement_id: string | null;
}

export interface LigneArticle {
  article_id: string;
  emplacement_id: string | null;
  lot: string;
  /** null : pas encore compté (ignoré). */
  quantite_comptee: number | null;
}

export interface SoldeInventaire {
  article_id: string;
  emplacement_id: string | null;
  lot: string;
  quantite: number;
}

export interface PerimetreInventaire {
  site_id: string;
  /** Emplacements du périmètre (zone et ses emplacements) ; null : tout le dépôt. */
  emplacements: ReadonlySet<string> | null;
}

export type EcartUnite =
  | { code: string; genre: "conforme" }
  | { code: string; genre: "deplacee"; de: string | null; vers: string | null }
  | { code: string; genre: "trouvee"; statut_avant: StatutUnite | null }
  | { code: string; genre: "manquante"; emplacement_id: string | null };

export interface EcartArticle {
  article_id: string;
  emplacement_id: string | null;
  lot: string;
  theorique: number;
  compte: number;
  ecart: number;
}

export interface BilanInventaire {
  unites: EcartUnite[];
  articles: EcartArticle[];
  /** Nombre d'écarts à corriger (hors unités conformes et lignes sans écart). */
  total: number;
}

const arrondi = (n: number) => Math.round(n * 1000) / 1000 + 0; // « + 0 » : jamais -0

export function calculerEcarts(params: {
  perimetre: PerimetreInventaire;
  unitesConnues: readonly UniteConnue[];
  lignesUnites: readonly LigneUnite[];
  lignesArticles: readonly LigneArticle[];
  soldes: readonly SoldeInventaire[];
}): BilanInventaire {
  const { perimetre, unitesConnues, lignesUnites, lignesArticles, soldes } = params;
  const parCode = new Map(unitesConnues.map((u) => [u.code, u]));
  const comptes = new Set(lignesUnites.map((l) => l.code));
  const unites: EcartUnite[] = [];

  for (const l of [...lignesUnites].sort((a, b) => a.code.localeCompare(b.code))) {
    const u = parCode.get(l.code);
    if (u && u.statut === "dans_depot" && u.site_id === perimetre.site_id) {
      if (l.emplacement_id === null || u.emplacement_id === l.emplacement_id) unites.push({ code: l.code, genre: "conforme" });
      else unites.push({ code: l.code, genre: "deplacee", de: u.emplacement_id, vers: l.emplacement_id });
    } else {
      unites.push({ code: l.code, genre: "trouvee", statut_avant: u?.statut ?? null });
    }
  }
  const attendues = unitesConnues
    .filter((u) => u.statut === "dans_depot" && u.site_id === perimetre.site_id && (perimetre.emplacements === null || (u.emplacement_id !== null && perimetre.emplacements.has(u.emplacement_id))))
    .sort((a, b) => a.code.localeCompare(b.code));
  for (const u of attendues) if (!comptes.has(u.code)) unites.push({ code: u.code, genre: "manquante", emplacement_id: u.emplacement_id });

  const articles: EcartArticle[] = [];
  for (const l of lignesArticles) {
    if (l.quantite_comptee === null) continue;
    const theorique = soldes.find((s) => s.article_id === l.article_id && s.emplacement_id === l.emplacement_id && s.lot === l.lot)?.quantite ?? 0;
    articles.push({ article_id: l.article_id, emplacement_id: l.emplacement_id, lot: l.lot, theorique, compte: l.quantite_comptee, ecart: arrondi(l.quantite_comptee - theorique) });
  }
  const total = unites.filter((u) => u.genre !== "conforme").length + articles.filter((a) => a.ecart !== 0).length;
  return { unites, articles, total };
}

/** Emplacements d'une zone : la zone et ses emplacements. */
export function emplacementsDeLaZone(zoneId: string, tous: readonly { id: string; parent_id: string | null }[]): Set<string> {
  return new Set(tous.filter((e) => e.id === zoneId || e.parent_id === zoneId).map((e) => e.id));
}

/** Phrase de bilan pour l'alerte et l'écran. */
export function phraseBilan(b: BilanInventaire): string {
  if (b.total === 0) return "Aucun écart : le stock correspond au comptage.";
  const manquantes = b.unites.filter((u) => u.genre === "manquante").length;
  const trouvees = b.unites.filter((u) => u.genre === "trouvee").length;
  const deplacees = b.unites.filter((u) => u.genre === "deplacee").length;
  const arts = b.articles.filter((a) => a.ecart !== 0).length;
  const morceaux = [
    manquantes ? `${manquantes} unité${manquantes > 1 ? "s" : ""} non retrouvée${manquantes > 1 ? "s" : ""}` : null,
    trouvees ? `${trouvees} unité${trouvees > 1 ? "s" : ""} trouvée${trouvees > 1 ? "s" : ""} hors stock` : null,
    deplacees ? `${deplacees} unité${deplacees > 1 ? "s" : ""} rangée${deplacees > 1 ? "s" : ""} ailleurs` : null,
    arts ? `${arts} écart${arts > 1 ? "s" : ""} de quantité` : null,
  ].filter(Boolean);
  return `${b.total} écart${b.total > 1 ? "s" : ""} : ${morceaux.join(", ")}.`;
}
