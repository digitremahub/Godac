/**
 * Profils d'activité du module Stock (fichier pur, testé dans
 * lib/stock/__tests__/profils.test.ts). Une entreprise active un ou plusieurs
 * profils dans Stock › Paramètres ; chaque profil fixe son vocabulaire, ses
 * unités et ses champs. Les profils « messagerie » et « palettes » suivent des
 * unités individualisées (un code = un colis ou une palette) ; « vrac » suit des
 * articles en quantité, avec lots et DLC facultatifs.
 */

export const PROFILS = ["messagerie", "palettes", "vrac"] as const;
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

export interface Profil {
  cle: CleProfil;
  libelle: string;
  description: string;
  /** Ce qu'on suit : des unités individualisées ou des articles en quantité. */
  suivi: "unites" | "articles";
  /** Mot employé à l'écran pour une unité (singulier, pluriel). */
  vocabulaire: { un: string; plusieurs: string; code: string; codeAide: string };
  /** Types d'unité proposés (profils à unités). */
  typesUnite: readonly TypeUnite[];
  /** Champs saisissables à l'entrée. */
  champs: readonly ("poids" | "volume" | "sscc" | "lot" | "dlc" | "typeUnite")[];
  /** Emplacements : libellé des zones proposées en exemple. */
  exempleEmplacement: string;
}

export const DEFINITION_PROFILS: Record<CleProfil, Profil> = {
  messagerie: {
    cle: "messagerie",
    libelle: "Messagerie / colis",
    description: "Colis suivis un par un par code-barres ou code colis, avec poids et volume.",
    suivi: "unites",
    vocabulaire: { un: "colis", plusieurs: "colis", code: "Code colis", codeAide: "Scannez le code-barres ou saisissez le numéro du colis." },
    typesUnite: ["colis"],
    champs: ["poids", "volume"],
    exempleEmplacement: "Zone tri, rayonnage A, bac 12",
  },
  palettes: {
    cle: "palettes",
    libelle: "Palettes / fret",
    description: "Palettes (EUR, demi-palette ou autre) avec poids, SSCC facultatif et emplacement quai, zone ou allée.",
    suivi: "unites",
    vocabulaire: { un: "palette", plusieurs: "palettes", code: "Numéro de palette ou SSCC", codeAide: "Scannez l'étiquette de la palette ou saisissez son numéro (SSCC : 18 chiffres)." },
    typesUnite: ["palette_eur", "demi_palette", "palette_autre"],
    champs: ["typeUnite", "poids", "sscc"],
    exempleEmplacement: "Quai 3, allée B, emplacement B-12",
  },
  vrac: {
    cle: "vrac",
    libelle: "Marchandises en vrac / références",
    description: "Articles identifiés par une référence, avec unité, seuil mini, lots et dates limites de consommation facultatifs.",
    suivi: "articles",
    vocabulaire: { un: "article", plusieurs: "articles", code: "Référence", codeAide: "Scannez le code de l'article ou choisissez-le dans la liste." },
    typesUnite: [],
    champs: ["lot", "dlc"],
    exempleEmplacement: "Rayonnage C, niveau 2",
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

/** Le profil « unités » (messagerie ou palettes) est-il actif ? */
export function avecUnites(profils: readonly CleProfil[]): boolean {
  return profils.some((p) => DEFINITION_PROFILS[p].suivi === "unites");
}

/** Le profil « articles » (vrac) est-il actif ? */
export function avecArticles(profils: readonly CleProfil[]): boolean {
  return profils.some((p) => DEFINITION_PROFILS[p].suivi === "articles");
}

/** Types d'unité proposés selon les profils actifs (toujours dans l'ordre colis, EUR, demi, autre). */
export function typesUniteAutorises(profils: readonly CleProfil[]): TypeUnite[] {
  const ouverts = new Set(profils.flatMap((p) => DEFINITION_PROFILS[p].typesUnite));
  return TYPES_UNITE.filter((t) => ouverts.has(t));
}

/** Un type d'unité est-il permis par les profils actifs ? */
export function typeUniteAutorise(profils: readonly CleProfil[], type: string): type is TypeUnite {
  return typesUniteAutorises(profils).includes(type as TypeUnite);
}

/** Profil d'activité (colonne `activite` des unités) correspondant à un type d'unité. */
export function activiteDuType(type: TypeUnite): "messagerie" | "palettes" {
  return type === "colis" ? "messagerie" : "palettes";
}

/** Vocabulaire de l'écran de mouvement : un seul profil à unités → son mot ; sinon « unité ». */
export function motUnite(profils: readonly CleProfil[]): { un: string; plusieurs: string; code: string; codeAide: string } {
  const unites = profils.filter((p) => DEFINITION_PROFILS[p].suivi === "unites");
  if (unites.length === 1) return DEFINITION_PROFILS[unites[0]!].vocabulaire;
  return { un: "unité", plusieurs: "unités", code: "Code colis, palette ou SSCC", codeAide: "Scannez le code-barres ou l'étiquette, ou saisissez le numéro." };
}

/** Libellé court des profils actifs, pour l'en-tête du module. */
export function libelleProfils(profils: readonly CleProfil[]): string {
  return profils.length === 0 ? "Aucun profil activé" : profils.map((p) => DEFINITION_PROFILS[p].libelle).join(" · ");
}

/** SSCC : 18 chiffres (GS1), la clé de contrôle n'est pas vérifiée (le code lu est gardé tel quel). */
export function sscc(valeur: unknown): string | null {
  if (typeof valeur !== "string") return null;
  const v = valeur.replace(/[\s()]/g, "").replace(/^00(?=\d{18}$)/, "");
  return /^\d{18}$/.test(v) ? v : null;
}
