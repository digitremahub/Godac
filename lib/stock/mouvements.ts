import { z } from "zod";
import { schemaAttributs, attributsPourRpc, type AttributsLus, type AttributsUnite } from "@/lib/stock/attributs";
import { analyserCodeInterne } from "@/lib/stock/codes";
import {
  PROFILS,
  avecArticles,
  avecUnites,
  champsManquants,
  champsObligatoires,
  messageChampsManquants,
  profilsArticles,
  profilsUnites,
  resoudreProfil,
  sscc as normaliserSscc,
  typeUniteAutorise,
  TYPES_UNITE,
  type ChampStock,
  type CleProfil,
  type ProfilsConfig,
  type ValeursChamps,
} from "@/lib/stock/profils";
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
  /** Profil d'activité de l'entrée (obligatoire quand plusieurs profils correspondent). */
  profil: z.enum(PROFILS).optional(),
  /** Code interne complémentaire (généré par « Générer un code »), à rattacher à l'unité d'origine. */
  code_interne: z.string().max(LONGUEUR_CODE_MAX).nullable().optional(),
  /** Attributs génériques de l'unité (nature, température, fragile, urgent, consigne, lot, DLC…). */
  attributs: schemaAttributs.optional(),
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
  /** Absents des appels des liens tournées : ils passent par la fonction d'origine. */
  p_profil?: CleProfil | null;
  p_code_interne?: string | null;
  p_attributs?: Record<string, unknown> | null;
}

export type ResultatValidation = { ok: true; params: ParametresRpcMouvement } | { ok: false; erreur: string };

export interface ContexteValidation {
  profils: readonly CleProfil[];
  role: string;
  /** Personnalisation des profils (stock_parametres.profils_config). */
  config?: ProfilsConfig | null;
  /** Unité déjà enregistrée sous ce code : ses valeurs comptent pour les champs obligatoires (entrée d'une unité connue). */
  uniteExistante?: (Partial<AttributsLus> & { poids_kg?: number | null; volume_m3?: number | null; sscc?: string | null }) | null;
}

/**
 * Profil d'une entrée : celui qui est demandé (il doit être actif et correspondre au suivi
 * unités / articles), sinon l'unique profil actif de ce suivi ; plusieurs possibles = à choisir.
 */
export function profilDeLEntree(profils: readonly CleProfil[], config: ProfilsConfig | null | undefined, cible: "unites" | "articles", choisi?: CleProfil): { ok: true; profil: CleProfil | null } | { ok: false; erreur: string } {
  const possibles = cible === "unites" ? profilsUnites(profils, config) : profilsArticles(profils, config);
  if (choisi) {
    if (!possibles.includes(choisi)) return { ok: false, erreur: "Ce profil n'est pas activé pour ce type de mouvement (voir les paramètres du stock)." };
    return { ok: true, profil: choisi };
  }
  if (possibles.length === 1) return { ok: true, profil: possibles[0]! };
  // Plusieurs profils possibles : le choix n'est exigé que si l'un d'eux impose des champs obligatoires.
  if (possibles.length > 1) {
    if (possibles.every((p) => champsObligatoires(resoudreProfil(p, config)).length === 0)) return { ok: true, profil: null };
    return { ok: false, erreur: "Choisissez le profil d'activité de cette entrée." };
  }
  return { ok: true, profil: null };
}

export function validerMouvement(entree: EntreeMouvement, contexte: ContexteValidation): ResultatValidation {
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
    if (lot || entree.dlc) return refus("Lot et date limite d'une unité se saisissent dans ses attributs (profil avec lot et DLC), pas dans les champs des articles.");
  } else {
    if (!avecArticles(contexte.profils)) return refus("Le suivi des marchandises en vrac n'est pas activé dans les paramètres du stock.");
    if (entree.quantite === undefined) return refus("Indiquez la quantité.");
    quantite = Math.round(entree.quantite * 1000) / 1000;
    if (quantite <= 0) return refus("La quantité doit être positive.");
  }

  if (type === "transfert" && !(entree.emplacement_dest_id)) return refus("Choisissez l'emplacement de destination.");
  if (type === "transfert" && parArticle && (entree.emplacement_source_id ?? null) === (entree.emplacement_dest_id ?? null)) return refus("L'origine et la destination sont identiques.");

  // Code interne complémentaire : format contrôlé ici, existence et ambiguïté par la base.
  let codeInterne: string | null = null;
  if (entree.code_interne && entree.code_interne.trim()) {
    if (!parUnite) return refus("Un code interne se rattache à une unité (colis, palette, échantillon), pas à un article.");
    if (type !== "entree" && !(type === "ajustement" && sens === 1)) return refus("Un code interne se rattache à l'entrée d'une unité, ou depuis sa fiche.");
    codeInterne = entree.code_interne.trim();
    if (!analyserCodeInterne(codeInterne)) return refus("Ce n'est pas un code interne valide (format PREFIXE-AAAA-NNNNNN) : utilisez « Générer un code ».");
  }

  // Profil et champs obligatoires (entrées seulement).
  const estEntree = type === "entree" || (type === "ajustement" && sens === 1);
  const choix = profilDeLEntree(contexte.profils, contexte.config, parUnite ? "unites" : "articles", entree.profil);
  if (!choix.ok) return refus(choix.erreur);
  const attributs: AttributsUnite | null = parUnite ? (entree.attributs ?? null) : null;
  if (estEntree && choix.profil) {
    const profil = resoudreProfil(choix.profil, contexte.config);
    const existant = contexte.uniteExistante ?? null;
    const texte = (nouveau: unknown, ancien: unknown): string | number | null => {
      const v = nouveau !== undefined && nouveau !== null && String(nouveau).trim() !== "" ? nouveau : ancien;
      return v === undefined || v === null || String(v).trim() === "" ? null : (v as string | number);
    };
    let valeurs: ValeursChamps;
    if (parUnite) {
      valeurs = {
        poids: texte(entree.poids_kg, existant?.poids_kg),
        volume: texte(entree.volume_m3, existant?.volume_m3),
        sscc: texte(ssccNormalise, existant?.sscc),
        lot: texte(attributs?.lot, existant?.lot),
        dlc: texte(attributs?.dlc, existant?.dlc),
        temperature: texte(attributs?.temperature, existant?.temperature),
        temperature_releve: texte(attributs?.temperature_releve, existant?.temperature_releve),
        nature: texte(attributs?.nature, existant?.nature),
        consigne: texte(attributs?.consigne, existant?.consigne),
        reference_client: texte(attributs?.reference_client, existant?.reference_client),
      };
    } else {
      // Un article ne porte que le lot et la DLC : les autres champs ne s'appliquent pas.
      const nonApplicable = Object.fromEntries((["poids", "volume", "sscc", "temperature", "temperature_releve", "nature", "consigne", "reference_client"] as ChampStock[]).map((c) => [c, "n/a"]));
      valeurs = { ...nonApplicable, lot: lot || null, dlc: entree.dlc || null };
    }
    const manquants = champsManquants(profil, valeurs);
    if (manquants.length) return refus(messageChampsManquants(profil, manquants));
  }

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
      p_profil: estEntree ? (choix.profil ?? null) : null,
      p_code_interne: codeInterne,
      p_attributs: estEntree ? attributsPourRpc(attributs) : null,
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
