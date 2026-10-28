/**
 * Formats d'étiquettes (fichier pur, testé dans lib/stock/__tests__/formats-etiquette.test.ts).
 *
 *   a4_2x4             feuille A4, 2 colonnes × 4 lignes = 8 étiquettes de 99,1 × 67,7 mm
 *                      (planche adhésive standard type Avery L7165)
 *   a4_3x7             feuille A4, 3 colonnes × 7 lignes = 21 étiquettes de 63,5 × 38,1 mm
 *                      (planche adhésive standard type Avery L7160)
 *   thermique_100x150  une étiquette de 100 × 150 mm par page (imprimante thermique)
 *   etiquette_62x29    une étiquette de 62 × 29 mm par page (rouleau type Brother DK-11209)
 *
 * Les dimensions sont en millimètres ; 1 point PDF = 1/72 pouce = 25,4/72 mm.
 */

export const FORMATS_ETIQUETTE = ["a4_2x4", "a4_3x7", "thermique_100x150", "etiquette_62x29"] as const;
export type CleFormatEtiquette = (typeof FORMATS_ETIQUETTE)[number];

export interface FormatEtiquette {
  cle: CleFormatEtiquette;
  libelle: string;
  aide: string;
  /** Page, en mm. */
  page: { largeur: number; hauteur: number };
  /** Une étiquette, en mm. */
  etiquette: { largeur: number; hauteur: number };
  colonnes: number;
  lignes: number;
  /** Marges de la planche, en mm. */
  margeHaut: number;
  margeGauche: number;
  /** Espace entre étiquettes, en mm. */
  ecartX: number;
  ecartY: number;
  /** Les formats sur planche A4 se découpent ou se décollent ; les autres sortent d'une imprimante d'étiquettes. */
  planche: boolean;
}

export const MM_EN_POINTS = 72 / 25.4;
export const mmEnPt = (mm: number): number => mm * MM_EN_POINTS;

export const DEFINITION_FORMATS: Record<CleFormatEtiquette, FormatEtiquette> = {
  a4_2x4: {
    cle: "a4_2x4",
    libelle: "Planche A4, 8 étiquettes (2 × 4)",
    aide: "99,1 × 67,7 mm, planche adhésive standard. Imprimez à l'échelle 100 % (sans « ajuster à la page »).",
    page: { largeur: 210, hauteur: 297 },
    etiquette: { largeur: 99.1, hauteur: 67.7 },
    colonnes: 2,
    lignes: 4,
    margeHaut: 13.1,
    margeGauche: 4.65,
    ecartX: 2.5,
    ecartY: 0,
    planche: true,
  },
  a4_3x7: {
    cle: "a4_3x7",
    libelle: "Planche A4, 21 étiquettes (3 × 7)",
    aide: "63,5 × 38,1 mm, planche adhésive standard. Imprimez à l'échelle 100 % (sans « ajuster à la page »).",
    page: { largeur: 210, hauteur: 297 },
    etiquette: { largeur: 63.5, hauteur: 38.1 },
    colonnes: 3,
    lignes: 7,
    margeHaut: 15.15,
    margeGauche: 7.2,
    ecartX: 2.5,
    ecartY: 0,
    planche: true,
  },
  thermique_100x150: {
    cle: "thermique_100x150",
    libelle: "Thermique 100 × 150 mm",
    aide: "Une étiquette par page, pour imprimante thermique (transport, palettes).",
    page: { largeur: 100, hauteur: 150 },
    etiquette: { largeur: 100, hauteur: 150 },
    colonnes: 1,
    lignes: 1,
    margeHaut: 0,
    margeGauche: 0,
    ecartX: 0,
    ecartY: 0,
    planche: false,
  },
  etiquette_62x29: {
    cle: "etiquette_62x29",
    libelle: "Petite étiquette 62 × 29 mm",
    aide: "Une étiquette par page, pour imprimante d'étiquettes à rouleau (tubes, boîtes, bacs).",
    page: { largeur: 62, hauteur: 29 },
    etiquette: { largeur: 62, hauteur: 29 },
    colonnes: 1,
    lignes: 1,
    margeHaut: 0,
    margeGauche: 0,
    ecartX: 0,
    ecartY: 0,
    planche: false,
  },
};

export const FORMAT_PAR_DEFAUT: CleFormatEtiquette = "a4_3x7";

export function estFormatEtiquette(v: unknown): v is CleFormatEtiquette {
  return typeof v === "string" && (FORMATS_ETIQUETTE as readonly string[]).includes(v);
}

export const parPage = (f: FormatEtiquette): number => f.colonnes * f.lignes;

/** Positions (coin haut gauche, en mm) des étiquettes d'une page, ligne par ligne. */
export function positionsEtiquettes(f: FormatEtiquette): { x: number; y: number }[] {
  const res: { x: number; y: number }[] = [];
  for (let l = 0; l < f.lignes; l++) {
    for (let c = 0; c < f.colonnes; c++) {
      res.push({ x: f.margeGauche + c * (f.etiquette.largeur + f.ecartX), y: f.margeHaut + l * (f.etiquette.hauteur + f.ecartY) });
    }
  }
  return res;
}

/** Les étiquettes tiennent-elles dans la page ? (utilisé par les tests) */
export function tientDansLaPage(f: FormatEtiquette): boolean {
  const dernier = positionsEtiquettes(f).at(-1)!;
  return dernier.x + f.etiquette.largeur <= f.page.largeur + 1e-9 && dernier.y + f.etiquette.hauteur <= f.page.hauteur + 1e-9;
}

/** Découpe une liste en pages. `debut` : nombre d'emplacements déjà utilisés sur la première planche (réutiliser une planche entamée). */
export function paginer<T>(elements: readonly T[], f: FormatEtiquette, debut = 0): (T | null)[][] {
  const taille = parPage(f);
  const saut = Math.max(0, Math.min(taille - 1, Math.floor(debut)));
  const pages: (T | null)[][] = [];
  let page: (T | null)[] = new Array(saut).fill(null);
  for (const e of elements) {
    page.push(e);
    if (page.length === taille) {
      pages.push(page);
      page = [];
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** Nombre de pages nécessaires. */
export function nombrePages(nombre: number, f: FormatEtiquette, debut = 0): number {
  if (nombre <= 0) return 0;
  return Math.ceil((nombre + Math.max(0, Math.min(parPage(f) - 1, Math.floor(debut)))) / parPage(f));
}

/** Nombre maximal d'étiquettes par document (borne le temps de génération). */
export const ETIQUETTES_MAX = 500;
