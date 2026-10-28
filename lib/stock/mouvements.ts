import { z } from "zod";
import { typeUniteAutorise, avecArticles, avecUnites, sscc as normaliserSscc, TYPES_UNITE, type CleProfil } from "@/lib/stock/profils";
import { TYPES_AVEC_MOTIF, TYPES_ENCADREMENT, TYPES_MOUVEMENT, sensDe, type TypeMouvement } from "@/lib/stock/transitions";

/**
 * Validation d'un mouvement de stock avant l'appel à la fonction SQL
 * `stock_enregistrer_mouvement` (fichier pur, testé dans
 * lib/stock/__tests__/mouvements.test.ts). La base revérifie tout : ce contrôle
 * donne des messages clairs avant l'aller-retour réseau.
 */

export const LONGUEUR_CODE_MAX = 80;
export const QUANTITE_MAX = 1_000_000_000;
export const MOTIF_MAX = 300;
export const LOT_MAX = 60;

const uuid = z.string().uuid();

export const schemaMouvement = z.object({
  /** Clé d'idempotence : générée par l'écran, rejouée telle quelle par la file hors ligne. */
  cle: z.string().min(8).max(100),
  type: z.enum(TYPES_MOUVEMENT),
  site_id: uuid,
  /** Colis ou palette : code lu au scanner ou saisi. */
  code: z.string().max(LONGUEUR_CODE_MAX * 4).optional(),
  type_unite: z.enum(TYPES_UNITE).optional(),
  /** Article en quantité. */
  article_id: uuid.optional(),
  quantite: z.number().positive().max(QUANTITE_MAX).optional(),
  emplacement_source_id: uuid.nullable().optional(),
  emplacement_dest_id: uuid.nullable().optional(),
  lot: z.string().max(LOT_MAX * 2).nullable().optional(),
  dlc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sens: z.union([z.literal(1), z.literal(-1)]).optional(),
  statut_apres: z.enum(["en_tournee", "livre", "retour", "dans_depot"]).optional(),
  motif: z.string().max(MOTIF_MAX * 2).nullable().optional(),
  run_id: uuid.nullable().optional(),
  stop_id: uuid.nullable().optional(),
  poids_kg: z.number().min(0).max(100_000).nullable().optional(),
  volume_m3: z.number().min(0).max(1_000).nullable().optional(),
  sscc: z.string().max(40).nullable().optional(),
});
export type EntreeMouvement = z.infer<typeof schemaMouvement>;

/** Code lu ou saisi → code propre (espaces et caractères de contrôle retirés), ou null. */
export function normaliserCode(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const code = brut.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!code || code.length > LONGUEUR_CODE_MAX) return null;
  return code;
}

/** Date AAAA-MM-JJ réelle ? */
export function dateValide(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Paramètres nommés de la fonction SQL stock_enregistrer_mouvement. */
export interface ParametresRpcMouvement {
  p_cle: string;
  p_type: TypeMouvement;
  p_site: string;
  p_unite_code: string | null;
  p_type_unite: string | null;
  p_article: string | null;
  p_quantite: number;
  p_src: string | null;
  p_dest: string | null;
  p_lot: string | null;
  p_dlc: string | null;
  p_sens: number | null;
  p_statut_apres: string | null;
  p_motif: string | null;
  p_run: string | null;
  p_stop: string | null;
  p_poids: number | null;
  p_volume: number | null;
  p_sscc: string | null;
  p_source: "app" | "tournee";
}

export type ResultatValidation = { ok: true; params: ParametresRpcMouvement } | { ok: false; erreur: string };

export function validerMouvement(entree: EntreeMouvement, contexte: { profils: readonly CleProfil[]; role: string }): ResultatValidation {
  const { type } = entree;
  const refus = (erreur: string): ResultatValidation => ({ ok: false, erreur });
  const parUnite = entree.code !== undefined && entree.code !== "";
  const parArticle = entree.article_id !== undefined;
  if (parUnite === parArticle) return refus(parUnite ? "Indiquez un code ou un article, pas les deux." : "Indiquez le code de l'unité ou choisissez un article.");

  if (TYPES_ENCADREMENT.includes(type) && contexte.role === "chauffeur") return refus("Un ajustement est réservé à l'encadrement.");
  if (contexte.profils.length === 0) return refus("Aucun profil d'activité n'est activé : la direction ou l'exploitation doit en choisir un dans les paramètres du stock.");

  const motif = (entree.motif ?? "").trim();
  if (TYPES_AVEC_MOTIF.includes(type) && !motif) return refus("Indiquez le motif.");
  if (motif.length > MOTIF_MAX) return refus(`Motif trop long (${MOTIF_MAX} caractères au plus).`);

  const sens = sensDe(type, entree.sens);
  if (sens === null) return refus("Un ajustement doit indiquer s'il ajoute ou retire du stock.");

  if (entree.statut_apres) {
    const permis = type === "sortie" ? ["en_tournee", "livre"] : type === "retour" ? ["retour", "dans_depot"] : [];
    if (!permis.includes(entree.statut_apres)) return refus("Statut demandé impossible pour ce mouvement.");
  }

  const lot = (entree.lot ?? "").trim();
  if (lot.length > LOT_MAX) return refus(`Lot trop long (${LOT_MAX} caractères au plus).`);
  if (entree.dlc && !dateValide(entree.dlc)) return refus("Date limite invalide.");

  let code: string | null = null;
  let quantite = 1;
  let typeUnite: string | null = null;
  let ssccNormalise: string | null = null;
  if (parUnite) {
    if (!avecUnites(contexte.profils)) return refus("Le suivi des colis et des palettes n'est pas activé dans les paramètres du stock.");
    code = normaliserCode(entree.code);
    if (!code) return refus(`Code invalide (1 à ${LONGUEUR_CODE_MAX} caractères).`);
    if (entree.type_unite) {
      if (!typeUniteAutorise(contexte.profils, entree.type_unite)) return refus("Ce type d'unité n'est pas activé dans les paramètres du stock.");
      typeUnite = entree.type_unite;
    }
    if (entree.sscc) {
      ssccNormalise = normaliserSscc(entree.sscc);
      if (!ssccNormalise) return refus("SSCC invalide : 18 chiffres attendus.");
    }
    if ((type === "entree" || (type === "ajustement" && sens === 1)) && !typeUnite) return refus("Choisissez le type d'unité (colis ou palette).");
    if (lot || entree.dlc) return refus("Lot et date limite ne concernent que les articles.");
  } else {
    if (!avecArticles(contexte.profils)) return refus("Le suivi des marchandises en vrac n'est pas activé dans les paramètres du stock.");
    if (entree.quantite === undefined) return refus("Indiquez la quantité.");
    quantite = Math.round(entree.quantite * 1000) / 1000;
    if (quantite <= 0) return refus("La quantité doit être positive.");
  }

  if (type === "transfert" && !(entree.emplacement_dest_id)) return refus("Choisissez l'emplacement de destination.");
  if (type === "transfert" && parArticle && (entree.emplacement_source_id ?? null) === (entree.emplacement_dest_id ?? null)) return refus("L'origine et la destination sont identiques.");

  return {
    ok: true,
    params: {
      p_cle: entree.cle,
      p_type: type,
      p_site: entree.site_id,
      p_unite_code: code,
      p_type_unite: typeUnite,
      p_article: parArticle ? entree.article_id! : null,
      p_quantite: quantite,
      p_src: entree.emplacement_source_id ?? null,
      p_dest: entree.emplacement_dest_id ?? null,
      p_lot: lot || null,
      p_dlc: entree.dlc || null,
      p_sens: type === "ajustement" ? sens : null,
      p_statut_apres: entree.statut_apres ?? null,
      p_motif: motif || null,
      p_run: entree.run_id ?? null,
      p_stop: entree.stop_id ?? null,
      p_poids: entree.poids_kg ?? null,
      p_volume: entree.volume_m3 ?? null,
      p_sscc: ssccNormalise,
      p_source: "app",
    },
  };
}

/** Clé d'idempotence d'une action de l'écran (UUID aléatoire, stable tant que l'action n'est pas confirmée). */
export function nouvelleCle(prefixe: string = "mvt"): string {
  const alea =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefixe}-${alea}`.slice(0, 100);
}
