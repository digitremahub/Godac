import { documentCsv } from "@/lib/paie/csv";
import { dateValide } from "@/lib/stock/mouvements";
import { LIBELLES_MOUVEMENT, LIBELLES_STATUT, estStatutUnite, estTypeMouvement, type TypeMouvement } from "@/lib/stock/transitions";

/**
 * Historique des mouvements : filtres, ligne d'affichage et export CSV (fichier
 * pur, testé dans lib/stock/__tests__/historique.test.ts). Le CSV suit celui des
 * autres modules (UTF-8 avec BOM, « ; », décimales à la virgule, formules neutralisées).
 */

export const PAGE_HISTORIQUE = 50;
/** Nombre maximal de lignes d'un export : au-delà, le fichier est tronqué et le dit. */
export const EXPORT_MAX_MOUVEMENTS = 10000;
export const FORMATS_EXPORT_STOCK = ["csv", "xlsx"] as const;
export type FormatExportStock = (typeof FORMATS_EXPORT_STOCK)[number];

export interface FiltresHistorique {
  du: string | null;
  au: string | null;
  type: TypeMouvement | null;
  /** Code d'unité (recherche partielle) ou référence d'article. */
  q: string | null;
  site: string | null;
  article: string | null;
  tournee: string | null;
  page: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtres lus dans l'adresse (valeurs invalides ignorées). */
export function lireFiltresHistorique(p: Record<string, string | undefined>): FiltresHistorique {
  const q = (p.q ?? "").replace(/[%_,()*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const page = Math.floor(Number(p.page ?? "1"));
  return {
    du: p.du && dateValide(p.du) ? p.du : null,
    au: p.au && dateValide(p.au) ? p.au : null,
    type: estTypeMouvement(p.type) ? p.type : null,
    q: q || null,
    site: p.site && uuid.test(p.site) ? p.site : null,
    article: p.article && uuid.test(p.article) ? p.article : null,
    tournee: p.tournee && uuid.test(p.tournee) ? p.tournee : null,
    page: Number.isFinite(page) && page >= 1 && page <= 10000 ? page : 1,
  };
}

export interface MouvementBrut {
  id: string;
  created_at: string;
  type: TypeMouvement;
  sens: number;
  quantite: number | string;
  unite_code: string | null;
  lot: string | null;
  dlc: string | null;
  statut_avant: string | null;
  statut_apres: string | null;
  motif: string | null;
  source: string;
  auteur_nom: string | null;
  run_id: string | null;
  stop_id: string | null;
  article?: { code: string; nom: string; unite: string } | { code: string; nom: string; unite: string }[] | null;
  site?: { nom: string } | { nom: string }[] | null;
  src?: { code: string } | { code: string }[] | null;
  dest?: { code: string } | { code: string }[] | null;
}

const un = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export interface LigneHistorique {
  id: string;
  date: string;
  heure: string;
  type: TypeMouvement;
  libelleType: string;
  objet: string;
  quantite: number;
  unite: string;
  depot: string;
  de: string;
  vers: string;
  lot: string;
  dlc: string;
  statut: string;
  motif: string;
  auteur: string;
  origine: string;
  tournee: boolean;
}

const FORMAT_PARIS = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Date et heure de Paris : « 28/10/2026 » et « 14:05 ». */
export function dateHeureParis(iso: string): { date: string; heure: string } {
  const parts = Object.fromEntries(FORMAT_PARIS.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.day}/${parts.month}/${parts.year}`, heure: `${parts.hour}:${parts.minute}` };
}

export function ligneHistorique(m: MouvementBrut): LigneHistorique {
  const article = un(m.article);
  const { date, heure } = dateHeureParis(m.created_at);
  const statutApres = m.statut_apres && estStatutUnite(m.statut_apres) ? LIBELLES_STATUT[m.statut_apres] : "";
  const statutAvant = m.statut_avant && estStatutUnite(m.statut_avant) ? LIBELLES_STATUT[m.statut_avant] : "";
  return {
    id: m.id,
    date,
    heure,
    type: m.type,
    libelleType: LIBELLES_MOUVEMENT[m.type],
    objet: m.unite_code ?? (article ? `${article.nom} (${article.code})` : "—"),
    quantite: Number(m.quantite),
    unite: article ? article.unite : m.unite_code ? "unité" : "",
    depot: un(m.site)?.nom ?? "",
    de: un(m.src)?.code ?? "",
    vers: un(m.dest)?.code ?? "",
    lot: m.lot ?? "",
    dlc: m.dlc ?? "",
    statut: statutAvant && statutApres && statutAvant !== statutApres ? `${statutAvant} → ${statutApres}` : statutApres,
    motif: m.motif ?? "",
    auteur: m.auteur_nom ?? "",
    origine: m.source === "tournee" ? "Tournée" : m.source === "inventaire" ? "Inventaire" : "Saisie",
    tournee: Boolean(m.run_id),
  };
}

export const ENTETE_EXPORT_STOCK = ["Date", "Heure", "Mouvement", "Unité ou article", "Quantité", "Unité", "Dépôt", "De", "Vers", "Lot", "DLC", "Statut", "Motif", "Auteur", "Origine", "Liée à une tournée"] as const;

export function csvMouvements(lignes: readonly LigneHistorique[], options: { tronque?: boolean } = {}): string {
  const cellules = lignes.map((l) => [l.date, l.heure, l.libelleType, l.objet, l.quantite, l.unite, l.depot, l.de, l.vers, l.lot, l.dlc, l.statut, l.motif, l.auteur, l.origine, l.tournee ? "oui" : "non"]);
  const pied: (string | number)[][] = options.tronque ? [[`Export tronqué à ${EXPORT_MAX_MOUVEMENTS} lignes : affinez la période.`]] : [];
  return documentCsv(ENTETE_EXPORT_STOCK, [...cellules, ...pied]);
}

export function nomFichierMouvements(du: string | null, au: string | null, format: FormatExportStock): string {
  return `mouvements-stock-${du ?? "debut"}-${au ?? "aujourdhui"}.${format}`;
}
