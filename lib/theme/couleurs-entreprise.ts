/**
 * Couleurs de l'entreprise (Administration › Organisation) : la direction
 * choisit trois couleurs — principale (remplace le teal : boutons
 * d'action, liens, éléments actifs), secondaire / d'alerte (remplace
 * l'orange) et menu (remplace le marine : barre latérale, en-têtes
 * sombres). Ce module en tire les variables CSS de app/globals.css pour
 * les thèmes clair et sombre, en garantissant la lisibilité (WCAG AA,
 * 4,5:1 pour le texte) :
 * - texte sur bouton : blanc ou encre, le plus contrasté ; si aucun des
 *   deux n'atteint 4,5:1, la couleur de fond est légèrement ajustée ;
 * - variantes « -ink » (texte coloré) : assombries sur fond clair,
 *   éclaircies sur fond sombre, même teinte ;
 * - menu : assez foncé pour du texte blanc (7:1, car le menu affiche
 *   aussi du blanc atténué).
 * Fonctions pures, testées dans __tests__/couleurs-entreprise.test.ts.
 */

export type CouleursEntreprise = { principale: string; secondaire: string; menu: string };

export const HEX_COULEUR = /^#[0-9a-fA-F]{6}$/;

export const COULEURS_GODAC: CouleursEntreprise = { principale: "#1BE4C1", secondaire: "#FF6B35", menu: "#0A0F1E" };

export const PALETTES: { nom: string; couleurs: CouleursEntreprise }[] = [
  { nom: "GODAC d'origine", couleurs: COULEURS_GODAC },
  { nom: "Bleu transport", couleurs: { principale: "#2563EB", secondaire: "#F59E0B", menu: "#0F172A" } },
  { nom: "Vert route", couleurs: { principale: "#16A34A", secondaire: "#DC2626", menu: "#052E16" } },
  { nom: "Rouge express", couleurs: { principale: "#DC2626", secondaire: "#F59E0B", menu: "#1C1917" } },
  { nom: "Violet", couleurs: { principale: "#7C3AED", secondaire: "#F97316", menu: "#1E1B4B" } },
  { nom: "Ardoise et ciel", couleurs: { principale: "#0EA5E9", secondaire: "#E11D48", menu: "#1E293B" } },
];

/** Fonds de app/globals.css sur lesquels le texte coloré doit rester lisible. */
export const FONDS = {
  papierClair: "#F6F7FB",
  surfaceClaire: "#FFFFFF",
  papierSombre: "#070B14",
  surfaceSombre: "#101726",
} as const;
export const ENCRE = "#0A0F1E";
export const BLANC = "#FFFFFF";
export const CONTRASTE_TEXTE = 4.5;
export const CONTRASTE_MENU = 7;

export function estHex(v: unknown): v is string {
  return typeof v === "string" && HEX_COULEUR.test(v);
}

export function hexVersRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

export function rgbVersHex([r, g, b]: [number, number, number]): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** « r g b » pour les variables CSS (rgb(var(--c-x) / alpha)). */
export function canaux(hex: string): string {
  return hexVersRgb(hex).join(" ");
}

/** Luminance relative WCAG, de 0 (noir) à 1 (blanc). */
export function luminance(hex: string): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexVersRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contraste(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function versHsl(hex: string): [number, number, number] {
  const [r8, g8, b8] = hexVersRgb(hex);
  const [r, g, b] = [r8 / 255, g8 / 255, b8 / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function depuisHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbVersHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/**
 * Assombrit (ou éclaircit) la couleur, à teinte égale, jusqu'à atteindre
 * le contraste visé contre `fond`. Sens « auto » : on s'éloigne du fond
 * (assombrir sur fond clair, éclaircir sur fond sombre). Renvoie la
 * couleur d'origine si elle suffit déjà ; au pire du noir ou du blanc.
 */
export function ajusterPourContraste(hex: string, fond: string, cible = CONTRASTE_TEXTE, sens: "assombrir" | "eclaircir" | "auto" = "auto"): string {
  if (contraste(hex, fond) >= cible) return hex.toUpperCase();
  const vers = sens === "auto" ? (luminance(fond) > 0.18 ? "assombrir" : "eclaircir") : sens;
  const [h, s, l] = versHsl(hex);
  for (let i = 1; i <= 100; i++) {
    const nl = vers === "assombrir" ? l - (l * i) / 100 : l + ((1 - l) * i) / 100;
    const candidat = depuisHsl(h, s, nl);
    if (contraste(candidat, fond) >= cible) return candidat;
  }
  return vers === "assombrir" ? "#000000" : BLANC;
}

/** Pire contraste de la couleur sur plusieurs fonds. */
function pireContraste(hex: string, fonds: readonly string[]): number {
  return Math.min(...fonds.map((f) => contraste(hex, f)));
}

/** Ajuste jusqu'à ce que la couleur soit lisible sur TOUS les fonds donnés. */
function lisibleSur(hex: string, fonds: readonly string[], sens: "assombrir" | "eclaircir"): string {
  let c = hex.toUpperCase();
  for (const f of fonds) c = ajusterPourContraste(c, f, CONTRASTE_TEXTE, sens);
  return c;
}

/** Texte posé sur un fond coloré : blanc ou encre, le plus lisible. */
export function texteSur(fond: string): { texte: string; ratio: number } {
  const blanc = contraste(BLANC, fond);
  const encre = contraste(ENCRE, fond);
  return blanc >= encre ? { texte: BLANC, ratio: blanc } : { texte: ENCRE, ratio: encre };
}

/**
 * Couleur de remplissage (bouton, badge) : si ni le blanc ni l'encre
 * n'atteignent 4,5:1 dessus, on la décale vers le côté le plus proche
 * (assombrie pour du texte blanc, éclaircie pour du texte encre).
 */
export function remplissageLisible(hex: string): { fond: string; texte: string; ajustee: boolean } {
  const base = hex.toUpperCase();
  const t = texteSur(base);
  if (t.ratio >= CONTRASTE_TEXTE) return { fond: base, texte: t.texte, ajustee: false };
  const fond = t.texte === BLANC ? ajusterPourContraste(base, BLANC, CONTRASTE_TEXTE, "assombrir") : ajusterPourContraste(base, ENCRE, CONTRASTE_TEXTE, "eclaircir");
  return { fond, texte: t.texte, ajustee: true };
}

/** Survol d'un bouton : un peu plus clair (texte encre) ou plus foncé (texte blanc), lisibilité conservée. */
function survol(fond: string, texte: string): string {
  const [h, s, l] = versHsl(fond);
  const candidat = depuisHsl(h, s, texte === BLANC ? Math.max(0, l - 0.06) : Math.min(1, l + 0.06));
  return contraste(candidat, texte) >= CONTRASTE_TEXTE ? candidat : fond;
}

export type ThemeEntreprise = {
  couleurs: CouleursEntreprise;
  principale: { fond: string; survol: string; texte: string; inkClair: string; inkSombre: string };
  secondaire: { fond: string; survol: string; texte: string; inkClair: string; inkSombre: string };
  menu: { fond: string; accent: string };
  /** Ajustements à signaler à la direction (phrases prêtes à afficher). */
  ajustements: string[];
};

function accent(hex: string, nom: string, ajustements: string[]) {
  const r = remplissageLisible(hex);
  if (r.ajustee) {
    ajustements.push(
      `${nom} ${r.texte === BLANC ? "assombrie" : "éclaircie"} (${hex.toUpperCase()} → ${r.fond}) pour que le texte des boutons et badges reste lisible.`,
    );
  }
  return {
    fond: r.fond,
    survol: survol(r.fond, r.texte),
    texte: r.texte,
    inkClair: lisibleSur(hex, [FONDS.papierClair, FONDS.surfaceClaire], "assombrir"),
    inkSombre: lisibleSur(hex, [FONDS.papierSombre, FONDS.surfaceSombre], "eclaircir"),
  };
}

/** Calcule toutes les variantes lisibles à partir des trois couleurs choisies. */
export function calculerTheme(couleurs: CouleursEntreprise): ThemeEntreprise {
  const ajustements: string[] = [];
  const principale = accent(couleurs.principale, "Couleur principale", ajustements);
  const secondaire = accent(couleurs.secondaire, "Couleur secondaire", ajustements);
  const menuChoisi = couleurs.menu.toUpperCase();
  const menu = ajusterPourContraste(menuChoisi, BLANC, CONTRASTE_MENU, "assombrir");
  if (menu !== menuChoisi) ajustements.push(`Couleur du menu assombrie (${menuChoisi} → ${menu}) pour que le texte blanc du menu reste lisible.`);
  // Élément actif du menu (texte coloré sur la couleur du menu).
  const accentMenu = ajusterPourContraste(principale.fond, menu, CONTRASTE_TEXTE, "eclaircir");
  return { couleurs, principale, secondaire, menu: { fond: menu, accent: accentMenu }, ajustements };
}

/** Lit la valeur stockée (jsonb) ; null si absente ou invalide. */
export function lireCouleursEntreprise(v: unknown): CouleursEntreprise | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!estHex(o.principale) || !estHex(o.secondaire) || !estHex(o.menu)) return null;
  return { principale: o.principale, secondaire: o.secondaire, menu: o.menu };
}

export function memesCouleurs(a: CouleursEntreprise, b: CouleursEntreprise): boolean {
  return a.principale.toUpperCase() === b.principale.toUpperCase() && a.secondaire.toUpperCase() === b.secondaire.toUpperCase() && a.menu.toUpperCase() === b.menu.toUpperCase();
}

function bloc(selecteur: string, vars: Record<string, string>): string {
  return `${selecteur}{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;
}

/**
 * Variables CSS par thème. Le menu s'applique partout ; les accents
 * s'appliquent aux thèmes clair, sombre et système — les thèmes Orange
 * GODAC restent un choix personnel et gardent leurs couleurs.
 */
export function variablesCss(t: ThemeEntreprise) {
  const commun = {
    "--c-teal": canaux(t.principale.fond),
    "--c-teal-hover": canaux(t.principale.survol),
    "--c-on-teal": canaux(t.principale.texte),
    "--c-orange": canaux(t.secondaire.fond),
    "--c-orange-hover": canaux(t.secondaire.survol),
    "--c-on-orange": canaux(t.secondaire.texte),
    "--c-tint-1": canaux(t.principale.fond),
    "--c-tint-3": canaux(t.secondaire.fond),
    // Les pastilles « OK » restent vertes : un succès ne doit pas
    // prendre la couleur de l'entreprise (rouge, par exemple).
    "--c-success": "27 228 193",
  };
  const clair = {
    "--c-teal-ink": canaux(t.principale.inkClair),
    "--c-orange-ink": canaux(t.secondaire.inkClair),
    "--c-halo": canaux(t.principale.inkClair),
    "--c-success-ink": "15 118 110",
  };
  const sombre = {
    "--c-teal-ink": canaux(t.principale.inkSombre),
    "--c-orange-ink": canaux(t.secondaire.inkSombre),
    "--c-halo": canaux(t.principale.inkSombre),
    "--c-success-ink": "46 230 198",
  };
  const menu = { "--c-marine": canaux(t.menu.fond), "--c-teal-sur-menu": canaux(t.menu.accent) };
  return { commun, clair, sombre, menu };
}

/**
 * Feuille de style injectée dans le tableau de bord et les écrans plein
 * écran. Ordre et spécificité (0,2,0) pensés pour passer après
 * app/globals.css : clair d'abord, puis sombre (système ou choisi).
 */
export function cssCouleursEntreprise(couleurs: CouleursEntreprise): string {
  const v = variablesCss(calculerTheme(couleurs));
  const horsOrange = ':root:not([data-theme^="orange"])';
  return [
    bloc(":root", v.menu),
    bloc(horsOrange, { ...v.commun, ...v.clair }),
    `@media (prefers-color-scheme: dark){${bloc(":root:not([data-theme])", v.sombre)}}`,
    bloc(':root[data-theme="dark"]', v.sombre),
  ].join("\n");
}
