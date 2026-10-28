import { LIBELLES_NATURE_COURTS, LIBELLES_TEMPERATURE_COURTS, libelleNature, libelleTemperature, type Nature, type Temperature } from "@/lib/stock/attributs";
import { encodable128 } from "@/lib/stock/code128";
import type { ChampEtiquette } from "@/lib/stock/profils";
import { DEFINITION_FORMATS, type FormatEtiquette } from "@/lib/stock/formats-etiquette";

/**
 * Contenu et mise en page d'une étiquette (fichier pur, testé dans
 * lib/stock/__tests__/etiquettes.test.ts). La mise en page est calculée en
 * millimètres, indépendamment du moteur PDF : les tests vérifient que tout reste
 * dans l'étiquette. Le QR code et le code-barres Code 128 portent UNIQUEMENT le
 * code : aucune donnée personnelle, aucun destinataire.
 */

export interface UniteEtiquetable {
  code: string;
  code_interne?: string | null;
  nature?: Nature | null;
  nature_libelle?: string | null;
  temperature?: Temperature | null;
  temperature_libelle?: string | null;
  fragile?: boolean;
  urgent?: boolean;
  consigne?: string | null;
  reference_client?: string | null;
  lot?: string | null;
  dlc?: string | null;
}

export interface ContexteEtiquette {
  entreprise: string;
  depot?: string | null;
  emplacement?: string | null;
  /** Date imprimée, déjà formatée (JJ/MM/AAAA). */
  date: string;
  /** Un logo est disponible (organizations.logo_url). */
  logo?: boolean;
}

export interface DonneesEtiquette {
  /** Code encodé dans le QR code et le code-barres : code interne s'il existe, sinon code principal. */
  code: string;
  entreprise: string | null;
  logo: boolean;
  depot: string | null;
  emplacement: string | null;
  nature: string | null;
  temperature: string | null;
  temperatureCle: Temperature | null;
  fragile: boolean;
  urgent: boolean;
  consigne: string | null;
  reference_client: string | null;
  lot: string | null;
  dlc: string | null;
  date: string | null;
}

const dateFr = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : null);

/** Code porté par l'étiquette d'une unité. */
export const codeEtiquette = (u: Pick<UniteEtiquetable, "code" | "code_interne">): string => u.code_interne || u.code;

/** Données imprimables d'une unité selon les champs choisis pour le profil. */
export function construireEtiquette(u: UniteEtiquetable, ctx: ContexteEtiquette, champs: readonly ChampEtiquette[]): DonneesEtiquette {
  const a = new Set(champs);
  const vide = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  return {
    code: codeEtiquette(u),
    entreprise: a.has("entreprise") ? vide(ctx.entreprise) : null,
    logo: a.has("entreprise") && Boolean(ctx.logo),
    depot: a.has("depot") ? vide(ctx.depot) : null,
    emplacement: a.has("emplacement") ? vide(ctx.emplacement) : null,
    nature: a.has("nature") ? vide(libelleNature(u.nature ?? null, u.nature_libelle, true)) : null,
    temperature: a.has("temperature") ? vide(libelleTemperature(u.temperature ?? null, u.temperature_libelle, true)) : null,
    temperatureCle: a.has("temperature") ? (u.temperature ?? null) : null,
    fragile: a.has("fragile") && Boolean(u.fragile),
    urgent: a.has("urgent") && Boolean(u.urgent),
    consigne: a.has("consigne") ? vide(u.consigne) : null,
    reference_client: a.has("reference_client") ? vide(u.reference_client) : null,
    lot: a.has("lot") ? vide(u.lot) : null,
    dlc: a.has("dlc") ? dateFr(u.dlc) : null,
    date: a.has("date") ? vide(ctx.date) : null,
  };
}

/** Étiquette vierge numérotée (planche de codes d'avance) : le code, l'entreprise et la date seulement. */
export function etiquetteVierge(code: string, ctx: ContexteEtiquette, champs: readonly ChampEtiquette[] = ["entreprise", "date"]): DonneesEtiquette {
  return construireEtiquette({ code }, ctx, champs.filter((c) => c === "entreprise" || c === "date" || c === "depot"));
}

// ── Mise en page ───────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  l: number;
  h: number;
}

export interface BlocTexte extends Rect {
  texte: string;
  /** Corps en points. */
  taille: number;
  gras?: boolean;
  alignement?: "left" | "center" | "right";
  lignesMax: number;
}

export interface Picto extends Rect {
  /** Texte du pictogramme, lisible en noir et blanc (imprimantes thermiques). */
  texte: string;
  type: "fragile" | "urgent" | "temperature";
  /** Pictogramme plein (blanc sur noir) : urgent. */
  plein: boolean;
}

export interface MiseEnPage {
  /** Dimensions de l'étiquette en mm. */
  largeur: number;
  hauteur: number;
  classe: "compact" | "standard" | "large";
  qr: Rect;
  /** Code-barres Code 128 (null si le code n'est pas encodable). */
  codeBarres: Rect | null;
  code: BlocTexte;
  logo: Rect | null;
  textes: BlocTexte[];
  pictos: Picto[];
}

export const PT_EN_MM = 25.4 / 72;
/** Largeur moyenne d'un caractère gras / lettre capitale, en fraction du corps. */
export const LARGEUR_CARACTERE = 0.62;
export const INTERLIGNE = 1.2;

/** Corps (pt) du plus gros texte qui tient sur `largeurMm` pour `n` caractères, borné. */
export function taillePourLargeur(n: number, largeurMm: number, maxPt: number, minPt = 5): number {
  if (n <= 0) return maxPt;
  const t = largeurMm / PT_EN_MM / (n * LARGEUR_CARACTERE);
  return Math.max(minPt, Math.min(maxPt, Math.floor(t * 2) / 2));
}

const hauteurTexte = (taille: number, lignes: number) => taille * INTERLIGNE * lignes * PT_EN_MM;
const lignesNecessaires = (texte: string, largeurMm: number, taille: number) => Math.max(1, Math.ceil((texte.length * taille * 0.55 * PT_EN_MM) / Math.max(1, largeurMm)));

export function classeDe(f: FormatEtiquette): MiseEnPage["classe"] {
  const h = f.etiquette.hauteur;
  return h < 35 ? "compact" : h < 50 ? "standard" : "large";
}

/**
 * Calcule la position de chaque élément d'une étiquette. Paysage / carré : QR à
 * gauche, colonne de texte à droite ; portrait : tout empilé. Un élément qui ne
 * tient plus est abandonné (jamais de débordement).
 */
export function mettreEnPage(format: FormatEtiquette | keyof typeof DEFINITION_FORMATS, d: DonneesEtiquette): MiseEnPage {
  const f = typeof format === "string" ? DEFINITION_FORMATS[format] : format;
  const W = f.etiquette.largeur;
  const H = f.etiquette.hauteur;
  const classe = classeDe(f);
  const p = classe === "compact" ? 1.5 : classe === "standard" ? 2 : 3.5;
  const portrait = H > W * 1.1;
  const barresPossibles = encodable128(d.code);
  const textes: BlocTexte[] = [];
  const pictos: Picto[] = [];
  let logo: Rect | null = null;

  const taillePetit = classe === "compact" ? 5 : classe === "standard" ? 5.5 : 8;
  const tailleCodeMax = classe === "compact" ? 10 : classe === "standard" ? 12 : portrait ? 26 : 20;

  // Zone de contenu textuel (colonne droite, ou pleine largeur en portrait) et QR.
  let qr: Rect;
  let colX: number;
  let colL: number;
  let y: number;
  const bas = H - p;
  if (portrait) {
    const s = Math.min(W - 2 * p, H * 0.36);
    qr = { x: (W - s) / 2, y: p, l: s, h: s };
    colX = p;
    colL = W - 2 * p;
    y = p + s + 2;
  } else {
    const s = Math.min(H - 2 * p - (classe === "large" ? 12 : classe === "standard" ? 5.5 : 0), W * 0.4);
    qr = { x: p, y: classe === "large" ? p + 12 : classe === "standard" ? p + 5.5 : p + (H - 2 * p - s) / 2, l: s, h: s };
    colX = p + s + p;
    colL = W - colX - p;
    y = classe === "compact" ? p : classe === "standard" ? p + 5.5 : p + 12;
  }

  // En-tête : logo + entreprise (+ date à droite) sur toute la largeur.
  const enTete = d.entreprise || d.logo || d.date;
  if (enTete && (classe !== "compact" || portrait)) {
    const hEnTete = classe === "large" ? 9 : 4.5;
    const gauche = p;
    let x = gauche;
    if (d.logo) {
      const lw = Math.min(W * 0.28, classe === "large" ? 24 : 12);
      logo = { x, y: p, l: lw, h: hEnTete - 0.5 };
      x += lw + 1.5;
    }
    const dateL = d.date ? Math.min(22, W * 0.3) : 0;
    const nomL = W - x - p - dateL - (dateL ? 1 : 0);
    const tNom = classe === "large" ? 10 : 6;
    if (d.entreprise && nomL > 8) textes.push({ x, y: p, l: nomL, h: hauteurTexte(tNom, 1), texte: d.entreprise, taille: tNom, gras: true, lignesMax: 1 });
    if (d.date && dateL > 0) textes.push({ x: W - p - dateL, y: p, l: dateL, h: hauteurTexte(taillePetit, 1), texte: d.date, taille: taillePetit, alignement: "right", lignesMax: 1 });
    if (portrait) {
      // L'en-tête prend la place du haut : le QR descend.
      qr = { ...qr, y: p + hEnTete + 1 };
      y = qr.y + qr.h + 2;
    }
  } else if (d.date && classe === "compact") {
    // Petite étiquette : la date tient dans le coin bas droit (voir plus bas).
  }

  // Code en gros caractères lisibles.
  const tailleCode = taillePourLargeur(d.code.length, colL, tailleCodeMax, 6);
  const code: BlocTexte = { x: colX, y, l: colL, h: hauteurTexte(tailleCode, 1), texte: d.code, taille: tailleCode, gras: true, alignement: portrait ? "center" : "left", lignesMax: 1 };
  y += code.h + 0.8;

  // Code-barres.
  let codeBarres: Rect | null = null;
  if (barresPossibles) {
    const hb = classe === "compact" ? 6.5 : classe === "standard" ? 8 : portrait ? 16 : 12;
    if (y + hb <= bas) {
      codeBarres = { x: colX, y, l: colL, h: hb };
      y += hb + 1.2;
    }
  }

  const poser = (texte: string | null, taille: number, lignesMax: number, gras = false) => {
    if (!texte) return;
    const lignes = Math.min(lignesMax, lignesNecessaires(texte, colL, taille));
    const h = hauteurTexte(taille, lignes);
    if (y + h > bas) return;
    textes.push({ x: colX, y, l: colL, h, texte, taille, gras, lignesMax: lignes, alignement: portrait ? "center" : "left" });
    y += h + 0.6;
  };

  // Pictogrammes : température, fragile, urgent (texte encadré, lisible en noir et blanc).
  const listePictos: Omit<Picto, keyof Rect>[] = [];
  if (d.temperature) listePictos.push({ texte: d.temperature, type: "temperature", plein: d.temperatureCle === "congele" });
  if (d.fragile) listePictos.push({ texte: "FRAGILE", type: "fragile", plein: false });
  if (d.urgent) listePictos.push({ texte: "URGENT", type: "urgent", plein: true });
  if (listePictos.length) {
    const hp = classe === "compact" ? 4 : classe === "standard" ? 4.6 : 7;
    if (y + hp <= bas) {
      const tp = classe === "compact" ? 5 : classe === "standard" ? 5.5 : 8.5;
      let x = colX;
      for (const pic of listePictos) {
        const lw = Math.min(colL, pic.texte.length * tp * 0.65 * PT_EN_MM + 3);
        if (x + lw > colX + colL + 0.01) break;
        pictos.push({ x, y, l: lw, h: hp, ...pic });
        x += lw + 1;
      }
      y += hp + 1;
    }
  }

  const tNature = taillePetit;
  // La consigne passe avant le reste : c'est l'information d'action de l'étiquette.
  poser(d.consigne, classe === "large" ? 10 : tNature, classe === "large" ? 3 : 2, true);
  poser([d.nature, d.lot ? `Lot ${d.lot}` : null, d.dlc ? `DLC ${d.dlc}` : null].filter(Boolean).join(" · ") || null, tNature, 2, true);
  poser([d.depot, d.emplacement].filter(Boolean).join(" · ") || null, tNature, 2);
  poser(d.reference_client ? `Réf. ${d.reference_client}` : null, tNature, 1);
  // Date : dans l'en-tête quand il y en a un ; sinon en bas à droite.
  if (d.date && !textes.some((t) => t.texte === d.date)) {
    const h = hauteurTexte(taillePetit, 1);
    const dy = Math.max(y, bas - h);
    if (dy + h <= H - 0.3) textes.push({ x: colX, y: dy, l: colL, h, texte: d.date, taille: taillePetit, alignement: "right", lignesMax: 1 });
  }

  return { largeur: W, hauteur: H, classe, qr, codeBarres, code, logo, textes, pictos };
}

/** Tout élément est-il dans l'étiquette ? (utilisé par les tests) */
export function toutDansEtiquette(m: MiseEnPage, tolerance = 0.01): boolean {
  const dedans = (r: Rect) => r.x >= -tolerance && r.y >= -tolerance && r.x + r.l <= m.largeur + tolerance && r.y + r.h <= m.hauteur + tolerance;
  return [m.qr, m.code, ...(m.codeBarres ? [m.codeBarres] : []), ...(m.logo ? [m.logo] : []), ...m.textes, ...m.pictos].every(dedans);
}

/** Deux éléments se chevauchent-ils ? (utilisé par les tests) */
export function seChevauchent(a: Rect, b: Rect, tolerance = 0.05): boolean {
  return a.x < b.x + b.l - tolerance && b.x < a.x + a.l - tolerance && a.y < b.y + b.h - tolerance && b.y < a.y + a.h - tolerance;
}

export { LIBELLES_NATURE_COURTS, LIBELLES_TEMPERATURE_COURTS };
