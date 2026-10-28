import { z } from "zod";
import { NATURES, TEMPERATURES, type Nature, type Temperature } from "@/lib/stock/attributs";
import { FORMATS_ETIQUETTE, type CleFormatEtiquette } from "@/lib/stock/formats-etiquette";

/**
 * Profils d'activité du module Stock (fichier pur, testé dans
 * lib/stock/__tests__/profils.test.ts et profils-config.test.ts).
 *
 * Le catalogue prédéfini apporte des valeurs par défaut sensées pour chaque
 * métier (colis, palettes, prélèvements / produits biologiques, médicaments,
 * alimentaire, vrac, personnalisé). L'entreprise en active un ou plusieurs et
 * AJUSTE chacun sans code : vocabulaire, champs affichés ou obligatoires, règles
 * d'alerte, contenu et format d'étiquette, suggestion FEFO. Seules les
 * différences avec le catalogue sont enregistrées (stock_parametres.profils_config,
 * validé par `schemaConfigProfils` côté API, contraintes de forme côté base).
 *
 * GODAC fournit un suivi logistique configurable ; le respect des exigences
 * réglementaires du secteur reste à la charge de l'entreprise.
 */

export const PROFILS = ["messagerie", "palettes", "sante", "pharmacie", "alimentaire", "vrac", "personnalise"] as const;
export type CleProfil = (typeof PROFILS)[number];

/** Types d'unité individualisée (colonne stock_unites.type_unite). */
export const TYPES_UNITE = ["colis", "palette_eur", "demi_palette", "palette_autre"] as const;
export type TypeUnite = (typeof TYPES_UNITE)[number];

/** Unités d'un article (colonne stock_articles.unite). */
export const UNITES_ARTICLE = ["piece", "colis", "palette", "carton", "kg", "litre", "metre", "autre"] as const;
export type UniteArticle = (typeof UNITES_ARTICLE)[number];

export const LIBELLES_TYPES_UNITE: Record<TypeUnite, string> = {
  colis: "Colis",
  palette_eur: "Palette EUR",
  demi_palette: "Demi-palette",
  palette_autre: "Palette (autre format)",
};

export const LIBELLES_UNITES_ARTICLE: Record<UniteArticle, string> = {
  piece: "pièce",
  colis: "colis",
  palette: "palette",
  carton: "carton",
  kg: "kg",
  litre: "litre",
  metre: "mètre",
  autre: "autre",
};

// ── Champs configurables ───────────────────────────────────────────────

/** Champs que chaque profil peut afficher, rendre obligatoires ou masquer. */
export const CHAMPS_STOCK = ["poids", "volume", "sscc", "lot", "dlc", "temperature", "temperature_releve", "nature", "fragile", "urgent", "consigne", "reference_client"] as const;
export type ChampStock = (typeof CHAMPS_STOCK)[number];
export type ModeChamp = "masque" | "affiche" | "requis";

export const LIBELLES_CHAMP: Record<ChampStock, string> = {
  poids: "Poids (kg)",
  volume: "Volume (m³)",
  sscc: "SSCC (18 chiffres)",
  lot: "Lot",
  dlc: "Date limite (DLC)",
  temperature: "Température cible",
  temperature_releve: "Température relevée (°C)",
  nature: "Nature",
  fragile: "Fragile",
  urgent: "Urgent",
  consigne: "Consigne",
  reference_client: "Référence client / bordereau",
};

/** Un champ « oui / non » ne peut pas être rendu obligatoire (cocher n'est pas un manque). */
export const CHAMPS_OUI_NON: readonly ChampStock[] = ["fragile", "urgent"];
export const CHAMPS_OBLIGATOIRES_POSSIBLES: readonly ChampStock[] = CHAMPS_STOCK.filter((c) => !CHAMPS_OUI_NON.includes(c));

/** Éléments imprimables sur l'étiquette (le QR code et le code-barres Code 128 y sont toujours). */
export const CHAMPS_ETIQUETTE = ["entreprise", "depot", "emplacement", "nature", "temperature", "fragile", "urgent", "consigne", "date", "lot", "dlc", "reference_client"] as const;
export type ChampEtiquette = (typeof CHAMPS_ETIQUETTE)[number];
export const LIBELLES_CHAMP_ETIQUETTE: Record<ChampEtiquette, string> = {
  entreprise: "Nom de l'entreprise (et logo)",
  depot: "Dépôt",
  emplacement: "Emplacement",
  nature: "Nature",
  temperature: "Température (pictogramme)",
  fragile: "Pictogramme fragile",
  urgent: "Pictogramme urgent",
  consigne: "Consigne",
  date: "Date",
  lot: "Lot",
  dlc: "DLC",
  reference_client: "Référence client",
};

export interface RegleAlertes {
  /** Alerte « DLC proche » à J-n (null : pas d'alerte). */
  dlcJours: number | null;
  seuilMini: boolean;
  nonRentre: boolean;
  ecartInventaire: boolean;
}

export interface Vocabulaire {
  un: string;
  plusieurs: string;
  code: string;
  codeAide: string;
}

export interface Profil {
  cle: CleProfil;
  libelle: string;
  description: string;
  /** Ce qu'on suit : des unités individualisées ou des articles en quantité. */
  suivi: "unites" | "articles";
  /** Valeur écrite dans les colonnes historiques (stock_parametres.profils, stock_unites.activite). */
  famille: "messagerie" | "palettes" | "vrac";
  vocabulaire: Vocabulaire;
  /** Types d'unité proposés (profils à unités). */
  typesUnite: readonly TypeUnite[];
  champs: Record<ChampStock, ModeChamp>;
  alertes: RegleAlertes;
  /** Suggérer à la sortie le lot dont la DLC est la plus proche (FEFO). */
  fefo: boolean;
  etiquette: { champs: readonly ChampEtiquette[]; format: CleFormatEtiquette };
  /** Valeurs proposées d'office à l'entrée. */
  defauts: { nature: Nature | null; temperature: Temperature | null; urgent: boolean };
  /** Emplacements : libellé des zones proposées en exemple. */
  exempleEmplacement: string;
  /** Rappel affiché dans les paramètres et à l'entrée. */
  avertissement: string | null;
}

const MASQUES: Record<ChampStock, ModeChamp> = {
  poids: "masque", volume: "masque", sscc: "masque", lot: "masque", dlc: "masque", temperature: "masque", temperature_releve: "masque",
  nature: "masque", fragile: "masque", urgent: "masque", consigne: "masque", reference_client: "masque",
};
const champs = (p: Partial<Record<ChampStock, ModeChamp>>): Record<ChampStock, ModeChamp> => ({ ...MASQUES, ...p });

const ALERTES_UNITES: RegleAlertes = { dlcJours: null, seuilMini: false, nonRentre: true, ecartInventaire: true };
const ALERTES_ARTICLES = (dlcJours: number | null): RegleAlertes => ({ dlcJours, seuilMini: true, nonRentre: false, ecartInventaire: true });

const AVERTISSEMENT_SANTE =
  "Ne saisissez aucune donnée de santé nominative. L'étiquette ne porte que le code. GODAC fournit un suivi logistique : le respect des exigences réglementaires du secteur (chaîne du froid, traçabilité sanitaire) reste à la charge de l'entreprise.";
const AVERTISSEMENT_PHARMA =
  "GODAC fournit un suivi logistique : la conformité aux exigences propres à la pharmacie et aux médicaments reste à la charge de l'entreprise. Ne saisissez aucune donnée de patient.";
const AVERTISSEMENT_ALIMENTAIRE =
  "GODAC fournit un suivi logistique : la conformité aux règles sanitaires et de chaîne du froid reste à la charge de l'entreprise.";

export const DEFINITION_PROFILS: Record<CleProfil, Profil> = {
  messagerie: {
    cle: "messagerie",
    libelle: "Colis / messagerie",
    description: "Colis suivis un par un par code-barres ou code colis, avec poids et volume.",
    suivi: "unites",
    famille: "messagerie",
    vocabulaire: { un: "colis", plusieurs: "colis", code: "Code colis", codeAide: "Scannez le code-barres ou saisissez le numéro du colis." },
    typesUnite: ["colis"],
    champs: champs({ poids: "affiche", volume: "affiche", reference_client: "affiche", fragile: "affiche", urgent: "affiche", consigne: "affiche" }),
    alertes: ALERTES_UNITES,
    fefo: false,
    etiquette: { champs: ["entreprise", "depot", "fragile", "urgent", "consigne", "date"], format: "a4_3x7" },
    defauts: { nature: "colis", temperature: null, urgent: false },
    exempleEmplacement: "Zone tri, rayonnage A, bac 12",
    avertissement: null,
  },
  palettes: {
    cle: "palettes",
    libelle: "Palettes / fret",
    description: "Palettes (EUR, demi-palette ou autre) avec poids, SSCC facultatif et emplacement quai, zone ou allée.",
    suivi: "unites",
    famille: "palettes",
    vocabulaire: { un: "palette", plusieurs: "palettes", code: "Numéro de palette ou SSCC", codeAide: "Scannez l'étiquette de la palette ou saisissez son numéro (SSCC : 18 chiffres)." },
    typesUnite: ["palette_eur", "demi_palette", "palette_autre"],
    champs: champs({ poids: "affiche", sscc: "affiche", reference_client: "affiche", fragile: "affiche", urgent: "affiche", consigne: "affiche", temperature: "affiche" }),
    alertes: ALERTES_UNITES,
    fefo: false,
    etiquette: { champs: ["entreprise", "depot", "emplacement", "temperature", "fragile", "urgent", "consigne", "date"], format: "thermique_100x150" },
    defauts: { nature: "palette", temperature: null, urgent: false },
    exempleEmplacement: "Quai 3, allée B, emplacement B-12",
    avertissement: null,
  },
  sante: {
    cle: "sante",
    libelle: "Santé : prélèvements et produits biologiques (dont sang)",
    description: "Échantillons, poches, tubes : un code par unité, température obligatoire, urgent proposé par défaut, étiquette sans donnée nominative.",
    suivi: "unites",
    famille: "messagerie",
    vocabulaire: { un: "échantillon", plusieurs: "échantillons", code: "Code de l'échantillon", codeAide: "Scannez l'étiquette de l'échantillon ou saisissez son code." },
    typesUnite: ["colis"],
    champs: champs({ temperature: "requis", temperature_releve: "affiche", nature: "affiche", fragile: "affiche", urgent: "affiche", consigne: "affiche", lot: "affiche", dlc: "affiche", reference_client: "affiche" }),
    alertes: { dlcJours: 2, seuilMini: false, nonRentre: true, ecartInventaire: true },
    fefo: false,
    etiquette: { champs: ["entreprise", "depot", "nature", "temperature", "fragile", "urgent", "consigne", "date"], format: "etiquette_62x29" },
    defauts: { nature: "prelevement", temperature: "frais", urgent: true },
    exempleEmplacement: "Réfrigérateur 1, étagère 2",
    avertissement: AVERTISSEMENT_SANTE,
  },
  pharmacie: {
    cle: "pharmacie",
    libelle: "Médicaments et pharmacie",
    description: "Références suivies par lot et date limite, FEFO (le plus proche de sa DLC sort en premier), alerte DLC proche et seuil mini.",
    suivi: "articles",
    famille: "vrac",
    vocabulaire: { un: "produit", plusieurs: "produits", code: "Référence", codeAide: "Scannez le code du produit ou choisissez-le dans la liste." },
    typesUnite: [],
    champs: champs({ lot: "requis", dlc: "requis", temperature: "affiche", nature: "affiche", consigne: "affiche" }),
    alertes: ALERTES_ARTICLES(90),
    fefo: true,
    etiquette: { champs: ["entreprise", "depot", "emplacement", "nature", "temperature", "lot", "dlc", "date"], format: "a4_3x7" },
    defauts: { nature: "medicament", temperature: null, urgent: false },
    exempleEmplacement: "Armoire A, tiroir 3",
    avertissement: AVERTISSEMENT_PHARMA,
  },
  alimentaire: {
    cle: "alimentaire",
    libelle: "Alimentaire (frais, surgelé, sec)",
    description: "Références suivies par lot et date limite, FEFO, alerte DLC proche, température frais / surgelé / ambiante.",
    suivi: "articles",
    famille: "vrac",
    vocabulaire: { un: "produit", plusieurs: "produits", code: "Référence", codeAide: "Scannez le code du produit ou choisissez-le dans la liste." },
    typesUnite: [],
    champs: champs({ lot: "requis", dlc: "requis", temperature: "affiche", nature: "affiche", consigne: "affiche" }),
    alertes: ALERTES_ARTICLES(7),
    fefo: true,
    etiquette: { champs: ["entreprise", "depot", "emplacement", "temperature", "lot", "dlc", "date"], format: "a4_3x7" },
    defauts: { nature: "alimentaire", temperature: null, urgent: false },
    exempleEmplacement: "Chambre froide 2, rack C",
    avertissement: AVERTISSEMENT_ALIMENTAIRE,
  },
  vrac: {
    cle: "vrac",
    libelle: "Références en vrac",
    description: "Articles identifiés par une référence, avec unité, seuil mini, lots et dates limites de consommation facultatifs.",
    suivi: "articles",
    famille: "vrac",
    vocabulaire: { un: "article", plusieurs: "articles", code: "Référence", codeAide: "Scannez le code de l'article ou choisissez-le dans la liste." },
    typesUnite: [],
    champs: champs({ lot: "affiche", dlc: "affiche" }),
    alertes: ALERTES_ARTICLES(30),
    fefo: true,
    etiquette: { champs: ["entreprise", "depot", "emplacement", "date"], format: "a4_3x7" },
    defauts: { nature: null, temperature: null, urgent: false },
    exempleEmplacement: "Rayonnage C, niveau 2",
    avertissement: null,
  },
  personnalise: {
    cle: "personnalise",
    libelle: "Personnalisé",
    description: "Profil neutre à composer vous-même : vocabulaire, champs, alertes et étiquette sont à choisir.",
    suivi: "unites",
    famille: "messagerie",
    vocabulaire: { un: "unité", plusieurs: "unités", code: "Code de l'unité", codeAide: "Scannez le code-barres ou l'étiquette, ou saisissez le numéro." },
    typesUnite: ["colis"],
    champs: champs({ nature: "affiche", consigne: "affiche" }),
    alertes: ALERTES_UNITES,
    fefo: false,
    etiquette: { champs: ["entreprise", "depot", "date"], format: "a4_3x7" },
    defauts: { nature: null, temperature: null, urgent: false },
    exempleEmplacement: "Zone A, emplacement 1",
    avertissement: null,
  },
};

export function estProfil(v: unknown): v is CleProfil {
  return typeof v === "string" && (PROFILS as readonly string[]).includes(v);
}

/** Profils valides d'une liste quelconque : sans doublon, dans l'ordre canonique. */
export function normaliserProfils(brut: unknown): CleProfil[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set(brut.filter(estProfil));
  return PROFILS.filter((p) => vus.has(p));
}

// ── Personnalisation (profils_config) ──────────────────────────────────

export const VOCABULAIRE_MAX = 30;
export const DLC_JOURS_MAX = 365;

const mot = z.string().trim().min(1).max(VOCABULAIRE_MAX);
const modeChamp = z.enum(["masque", "affiche", "requis"]);

export const schemaConfigProfil = z
  .object({
    vocabulaire: z.object({ un: mot, plusieurs: mot }).strict().optional(),
    champs: z.record(z.enum(CHAMPS_STOCK), modeChamp).optional(),
    alertes: z
      .object({
        dlc_jours: z.number().int().min(1).max(DLC_JOURS_MAX).nullable().optional(),
        seuil_mini: z.boolean().optional(),
        non_rentre: z.boolean().optional(),
        ecart_inventaire: z.boolean().optional(),
      })
      .strict()
      .optional(),
    etiquette: z
      .object({
        champs: z.array(z.enum(CHAMPS_ETIQUETTE)).max(CHAMPS_ETIQUETTE.length).optional(),
        format: z.enum(FORMATS_ETIQUETTE).optional(),
      })
      .strict()
      .optional(),
    fefo: z.boolean().optional(),
    /** Seulement pour « personnalisé » : suivre des unités ou des articles. */
    suivi: z.enum(["unites", "articles"]).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const [champ, mode] of Object.entries(c.champs ?? {})) {
      if (mode === "requis" && CHAMPS_OUI_NON.includes(champ as ChampStock)) {
        ctx.addIssue({ code: "custom", message: `« ${LIBELLES_CHAMP[champ as ChampStock]} » ne peut pas être obligatoire.`, path: ["champs", champ] });
      }
    }
  });
export type ConfigProfil = z.infer<typeof schemaConfigProfil>;

export const schemaProfilsConfig = z
  .object({
    version: z.literal(1),
    actifs: z.array(z.enum(PROFILS)).max(PROFILS.length),
    profils: z.record(z.enum(PROFILS), schemaConfigProfil),
  })
  .strict();
export type ProfilsConfig = z.infer<typeof schemaProfilsConfig>;

export const CONFIG_VIDE: ProfilsConfig = { version: 1, actifs: [], profils: {} };

/** Lit un jsonb quelconque : valide, ou à défaut une configuration vide (jamais d'exception). */
export function lireProfilsConfig(brut: unknown): ProfilsConfig {
  const r = schemaProfilsConfig.safeParse(brut);
  if (r.success) return { ...r.data, actifs: normaliserProfils(r.data.actifs) };
  // Configuration partiellement valide : on récupère au moins les profils actifs.
  const actifs = normaliserProfils((brut as { actifs?: unknown } | null)?.actifs);
  return { version: 1, actifs, profils: {} };
}

/** Profil effectif : catalogue + ajustements de l'entreprise. */
export function resoudreProfil(cle: CleProfil, config: ProfilsConfig | null | undefined): Profil {
  const base = DEFINITION_PROFILS[cle];
  const c = config?.profils?.[cle];
  if (!c) return base;
  const suivi = cle === "personnalise" && c.suivi ? c.suivi : base.suivi;
  const famille = suivi === "articles" ? "vrac" : base.famille;
  return {
    ...base,
    suivi,
    famille,
    vocabulaire: c.vocabulaire ? { ...base.vocabulaire, ...c.vocabulaire } : base.vocabulaire,
    typesUnite: suivi === "articles" ? [] : base.typesUnite.length ? base.typesUnite : ["colis"],
    champs: { ...base.champs, ...(c.champs ?? {}) },
    alertes: {
      dlcJours: c.alertes && "dlc_jours" in c.alertes ? (c.alertes.dlc_jours ?? null) : base.alertes.dlcJours,
      seuilMini: c.alertes?.seuil_mini ?? base.alertes.seuilMini,
      nonRentre: c.alertes?.non_rentre ?? base.alertes.nonRentre,
      ecartInventaire: c.alertes?.ecart_inventaire ?? base.alertes.ecartInventaire,
    },
    fefo: c.fefo ?? base.fefo,
    etiquette: { champs: c.etiquette?.champs ?? base.etiquette.champs, format: c.etiquette?.format ?? base.etiquette.format },
  };
}

/** Profils effectifs des profils actifs, dans l'ordre canonique. */
export function profilsEffectifs(actifs: readonly CleProfil[], config: ProfilsConfig | null | undefined): Profil[] {
  return actifs.map((c) => resoudreProfil(c, config));
}

/** Champs obligatoires d'un profil (liste utilisée à l'écran, par l'API ; la fonction SQL relit la même configuration). */
export function champsObligatoires(profil: Profil): ChampStock[] {
  return CHAMPS_STOCK.filter((c) => profil.champs[c] === "requis" && !CHAMPS_OUI_NON.includes(c));
}

/** Champs à afficher (affichés ou obligatoires). */
export function champsVisibles(profil: Profil): ChampStock[] {
  return CHAMPS_STOCK.filter((c) => profil.champs[c] !== "masque");
}

/** Valeur d'un champ saisi (pour contrôler les champs obligatoires). */
export type ValeursChamps = Partial<Record<ChampStock, string | number | boolean | null | undefined>>;

/** Champs obligatoires non renseignés. */
export function champsManquants(profil: Profil, valeurs: ValeursChamps): ChampStock[] {
  return champsObligatoires(profil).filter((c) => {
    const v = valeurs[c];
    if (v === null || v === undefined) return true;
    if (typeof v === "string") return v.trim() === "";
    return false;
  });
}

/** Phrase d'erreur pour des champs obligatoires manquants. */
export function messageChampsManquants(profil: Profil, manquants: readonly ChampStock[]): string {
  const liste = manquants.map((c) => `« ${LIBELLES_CHAMP[c]} »`).join(", ");
  return manquants.length > 1 ? `Champs obligatoires pour le profil ${profil.libelle} : ${liste}.` : `Champ obligatoire pour le profil ${profil.libelle} : ${liste}.`;
}

// ── Fonctions héritées (profils actifs) ────────────────────────────────

const suiviDe = (p: CleProfil, config?: ProfilsConfig | null): "unites" | "articles" => resoudreProfil(p, config).suivi;

/** Le suivi par unités individualisées (colis, palettes, échantillons…) est-il actif ? */
export function avecUnites(profils: readonly CleProfil[], config?: ProfilsConfig | null): boolean {
  return profils.some((p) => suiviDe(p, config) === "unites");
}

/** Le suivi par articles en quantité est-il actif ? */
export function avecArticles(profils: readonly CleProfil[], config?: ProfilsConfig | null): boolean {
  return profils.some((p) => suiviDe(p, config) === "articles");
}

/** Profils actifs qui suivent des unités / des articles. */
export function profilsUnites(profils: readonly CleProfil[], config?: ProfilsConfig | null): CleProfil[] {
  return profils.filter((p) => suiviDe(p, config) === "unites");
}
export function profilsArticles(profils: readonly CleProfil[], config?: ProfilsConfig | null): CleProfil[] {
  return profils.filter((p) => suiviDe(p, config) === "articles");
}

/** Types d'unité proposés selon les profils actifs (toujours dans l'ordre colis, EUR, demi, autre). */
export function typesUniteAutorises(profils: readonly CleProfil[], config?: ProfilsConfig | null): TypeUnite[] {
  const ouverts = new Set(profilsUnites(profils, config).flatMap((p) => resoudreProfil(p, config).typesUnite));
  return TYPES_UNITE.filter((t) => ouverts.has(t));
}

/** Un type d'unité est-il permis par les profils actifs ? */
export function typeUniteAutorise(profils: readonly CleProfil[], type: string, config?: ProfilsConfig | null): type is TypeUnite {
  return typesUniteAutorises(profils, config).includes(type as TypeUnite);
}

/** Valeur historique des colonnes `activite` / `profils` pour un profil. */
export function familleDuProfil(cle: CleProfil, config?: ProfilsConfig | null): "messagerie" | "palettes" | "vrac" {
  return resoudreProfil(cle, config).famille;
}

/** Familles historiques de profils actifs (colonne stock_parametres.profils, contrainte check sur trois valeurs). */
export function famillesDe(actifs: readonly CleProfil[], config?: ProfilsConfig | null): ("messagerie" | "palettes" | "vrac")[] {
  const set = new Set(actifs.map((p) => familleDuProfil(p, config)));
  return (["messagerie", "palettes", "vrac"] as const).filter((f) => set.has(f));
}

/** Profil d'activité (colonne `activite` des unités) correspondant à un type d'unité. */
export function activiteDuType(type: TypeUnite): "messagerie" | "palettes" {
  return type === "colis" ? "messagerie" : "palettes";
}

/** Vocabulaire de l'écran de mouvement : un seul profil à unités → son mot ; sinon « unité ». */
export function motUnite(profils: readonly CleProfil[], config?: ProfilsConfig | null): Vocabulaire {
  const unites = profilsUnites(profils, config);
  if (unites.length === 1) return resoudreProfil(unites[0]!, config).vocabulaire;
  return { un: "unité", plusieurs: "unités", code: "Code colis, palette ou échantillon", codeAide: "Scannez le code-barres ou l'étiquette, ou saisissez le numéro." };
}

/** Libellé court des profils actifs, pour l'en-tête du module. */
export function libelleProfils(profils: readonly CleProfil[]): string {
  return profils.length === 0 ? "Aucun profil activé" : profils.map((p) => DEFINITION_PROFILS[p].libelle).join(" · ");
}

/** Nature et température proposées d'office pour un profil à l'entrée. */
export function defautsProfil(profil: Profil): { nature: Nature | null; temperature: Temperature | null; urgent: boolean } {
  return profil.defauts;
}

/** Listes de contrôle pour les tests et la base. */
export const NATURES_PROFIL = NATURES;
export const TEMPERATURES_PROFIL = TEMPERATURES;

/** SSCC : 18 chiffres (GS1), la clé de contrôle n'est pas vérifiée (le code lu est gardé tel quel). */
export function sscc(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const v = valeur.replace(/[\s()]/g, "").replace(/^00(?=\d{18}$)/, "");
  return /^\d{18}$/.test(v) ? v : null;
}

// ── Édition d'un profil (écran des paramètres) ─────────────────────────

const memesElements = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Ajustements d'un profil édité par rapport au catalogue : seules les différences sont enregistrées. */
export function differencesProfil(cle: CleProfil, edite: Profil): ConfigProfil {
  const base = DEFINITION_PROFILS[cle];
  const diff: ConfigProfil = {};
  if (edite.vocabulaire.un !== base.vocabulaire.un || edite.vocabulaire.plusieurs !== base.vocabulaire.plusieurs) {
    diff.vocabulaire = { un: edite.vocabulaire.un.trim() || base.vocabulaire.un, plusieurs: edite.vocabulaire.plusieurs.trim() || base.vocabulaire.plusieurs };
  }
  const champsDiff = CHAMPS_STOCK.filter((c) => edite.champs[c] !== base.champs[c]);
  if (champsDiff.length) diff.champs = Object.fromEntries(champsDiff.map((c) => [c, edite.champs[c]]));
  const alertes: NonNullable<ConfigProfil["alertes"]> = {};
  if (edite.alertes.dlcJours !== base.alertes.dlcJours) alertes.dlc_jours = edite.alertes.dlcJours;
  if (edite.alertes.seuilMini !== base.alertes.seuilMini) alertes.seuil_mini = edite.alertes.seuilMini;
  if (edite.alertes.nonRentre !== base.alertes.nonRentre) alertes.non_rentre = edite.alertes.nonRentre;
  if (edite.alertes.ecartInventaire !== base.alertes.ecartInventaire) alertes.ecart_inventaire = edite.alertes.ecartInventaire;
  if (Object.keys(alertes).length) diff.alertes = alertes;
  const etiquette: NonNullable<ConfigProfil["etiquette"]> = {};
  if (!memesElements(edite.etiquette.champs, base.etiquette.champs)) etiquette.champs = [...edite.etiquette.champs];
  if (edite.etiquette.format !== base.etiquette.format) etiquette.format = edite.etiquette.format;
  if (Object.keys(etiquette).length) diff.etiquette = etiquette;
  if (edite.fefo !== base.fefo) diff.fefo = edite.fefo;
  if (cle === "personnalise" && edite.suivi !== base.suivi) diff.suivi = edite.suivi;
  return diff;
}
