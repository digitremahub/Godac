/**
 * Codes internes du stock (fichier pur, testé dans lib/stock/__tests__/codes.test.ts).
 *
 * Format : PREFIXE-AAAA-NNNNNN (préfixe de 2 à 6 caractères A-Z0-9 propre à
 * l'entreprise, année de Paris, compteur à 6 chiffres par organisation et par
 * année). Le compteur est atomique côté base (fonction SQL stock_generer_codes) ;
 * `planifierCodes` reproduit sa logique pour les tests.
 *
 * Règle « garder le code existant » : si l'unité arrive avec un code (code-barres
 * transporteur ou client, SSCC, bordereau), ce code reste le code PRINCIPAL ; le
 * code interne n'est qu'un code complémentaire, proposé si l'entreprise le
 * demande ou si aucun code n'est fourni. Le scan résout les deux codes ; aucun
 * code ne peut désigner deux unités.
 */

export const PREFIXE_MIN = 2;
export const PREFIXE_MAX = 6;
export const COMPTEUR_MAX = 999_999;
export const CODES_MAX_PAR_APPEL = 500;
export const PREFIXE_PAR_DEFAUT_SECOURS = "STK";
export const LONGUEUR_CODE_MAX = 80;

const FORMAT_PREFIXE = /^[A-Z0-9]{2,6}$/;
const FORMAT_CODE_INTERNE = /^([A-Z0-9]{2,6})-(\d{4})-(\d{6})$/;

/** Préfixe saisi → préfixe propre (majuscules, sans espace ni tiret), ou null s'il est invalide. */
export function normaliserPrefixe(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  const p = brut.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s-]/g, "").toUpperCase();
  return FORMAT_PREFIXE.test(p) ? p : null;
}

export function prefixeValide(p: unknown): p is string {
  return typeof p === "string" && FORMAT_PREFIXE.test(p);
}

const MOTS_VIDES = new Set(["DE", "DU", "DES", "LA", "LE", "LES", "ET", "AU", "AUX", "SA", "SAS", "SASU", "SARL", "EURL", "SCOP", "GROUPE", "STE", "SOCIETE", "ETS", "ETABLISSEMENTS", "THE", "AND", "LTD", "GMBH"]);

/**
 * Préfixe par défaut dérivé du nom de l'entreprise : initiales de 2 à 3 mots
 * significatifs (« Transports Martin et Fils » → TMF), sinon les 3 premières
 * lettres du seul mot (« Transdev » → TRA). Secours : STK. Même logique que la
 * fonction SQL stock__prefixe_defaut (comparée dans les tests de contrat).
 */
export function prefixeParDefaut(nom: string | null | undefined): string {
  const texte = (nom ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  const mots = texte.split(" ").filter((m) => m && !MOTS_VIDES.has(m));
  let p = "";
  if (mots.length >= 2) p = mots.slice(0, 3).map((m) => m[0]).join("");
  else if (mots.length === 1) p = mots[0]!.slice(0, 3);
  return p.length >= PREFIXE_MIN ? p : PREFIXE_PAR_DEFAUT_SECOURS;
}

export function formaterCodeInterne(prefixe: string, annee: number, numero: number): string {
  if (!prefixeValide(prefixe)) throw new Error("Préfixe invalide.");
  if (!Number.isInteger(annee) || annee < 2000 || annee > 9999) throw new Error("Année invalide.");
  if (!Number.isInteger(numero) || numero < 1 || numero > COMPTEUR_MAX) throw new Error("Numéro hors limites.");
  return `${prefixe}-${annee}-${String(numero).padStart(6, "0")}`;
}

export interface CodeInterneAnalyse {
  prefixe: string;
  annee: number;
  numero: number;
}

/** Décompose un code interne, ou null si ce n'en est pas un (code transporteur, SSCC…). */
export function analyserCodeInterne(code: string): CodeInterneAnalyse | null {
  const m = FORMAT_CODE_INTERNE.exec(code);
  return m ? { prefixe: m[1]!, annee: Number(m[2]), numero: Number(m[3]) } : null;
}

export const estCodeInterne = (code: string): boolean => analyserCodeInterne(code) !== null;

/** Nombre demandé valide (entier de 1 à 500) ? */
export function nombreCodesValide(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= CODES_MAX_PAR_APPEL;
}

export interface PlanCodes {
  codes: string[];
  /** Nouvelle valeur du compteur après génération. */
  dernier: number;
  /** Numéros sautés parce que le code existait déjà (code saisi à la main, par exemple). */
  sautes: number[];
}

/**
 * Reproduit stock_generer_codes : à partir du dernier numéro attribué, attribue
 * `nombre` codes consécutifs en sautant ceux qui existent déjà (collision avec un
 * code saisi), et dit où le compteur s'arrête. Lève une erreur au-delà de 999 999.
 */
export function planifierCodes(p: { prefixe: string; annee: number; dernierActuel: number; nombre: number; occupes?: ReadonlySet<string> }): PlanCodes {
  if (!nombreCodesValide(p.nombre)) throw new Error("Nombre de codes invalide (1 à 500).");
  const occupes = p.occupes ?? new Set<string>();
  const codes: string[] = [];
  const sautes: number[] = [];
  let n = p.dernierActuel;
  while (codes.length < p.nombre) {
    n += 1;
    if (n > COMPTEUR_MAX) throw new Error("stock_compteur_epuise");
    const code = formaterCodeInterne(p.prefixe, p.annee, n);
    if (occupes.has(code)) sautes.push(n);
    else codes.push(code);
  }
  return { codes, dernier: n, sautes };
}

/** Année civile de Paris d'une date. */
export function anneeDeParis(date: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(date));
}

// ── Résolution et unicité ──────────────────────────────────────────────

export interface UniteCodee {
  id: string;
  code: string;
  code_interne: string | null;
}

export type ResolutionCode = { unite: UniteCodee; via: "code" | "code_interne" } | null;

/** Code lu ou saisi → code propre (espaces et caractères de contrôle retirés), ou null. */
export function nettoyerCode(brut: unknown): string | null {
  if (typeof brut !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const c = brut.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  return c && c.length <= LONGUEUR_CODE_MAX ? c : null;
}

/** Retrouve une unité par son code principal OU son code interne complémentaire. */
export function resoudreCode(saisie: string, unites: readonly UniteCodee[]): ResolutionCode {
  const c = nettoyerCode(saisie);
  if (!c) return null;
  const parCode = unites.find((u) => u.code === c);
  if (parCode) return { unite: parCode, via: "code" };
  const parInterne = unites.find((u) => u.code_interne === c);
  return parInterne ? { unite: parInterne, via: "code_interne" } : null;
}

export type VerdictCode = { ok: true } | { ok: false; erreur: "stock_code_ambigu" | "stock_code_interne_inconnu" | "stock_code_interne_invalide"; message: string };

/**
 * Peut-on rattacher `codeInterne` à l'unité `uniteId` ? Refus clair si ce code
 * désigne déjà une autre unité (comme code principal ou comme code interne).
 */
export function verifierCodeInterne(codeInterne: string, uniteId: string | null, unites: readonly UniteCodee[], emis?: ReadonlySet<string>): VerdictCode {
  const c = nettoyerCode(codeInterne);
  if (!c || !estCodeInterne(c)) return { ok: false, erreur: "stock_code_interne_invalide", message: "Ce n'est pas un code interne (format PREFIXE-AAAA-NNNNNN)." };
  if (emis && !emis.has(c)) return { ok: false, erreur: "stock_code_interne_inconnu", message: "Ce code interne n'a pas été généré pour votre entreprise." };
  const autre = unites.find((u) => u.id !== uniteId && (u.code === c || u.code_interne === c));
  if (autre) return { ok: false, erreur: "stock_code_ambigu", message: `Le code « ${c} » désigne déjà une autre unité : un code ne peut identifier qu'une seule unité.` };
  return { ok: true };
}

/** Un nouveau code principal entre-t-il en conflit avec le code interne d'une autre unité ? (le scan l'aurait alors résolu) */
export function verifierCodePrincipal(code: string, uniteId: string | null, unites: readonly UniteCodee[]): VerdictCode {
  const c = nettoyerCode(code);
  if (!c) return { ok: false, erreur: "stock_code_interne_invalide", message: `Code invalide (1 à ${LONGUEUR_CODE_MAX} caractères).` };
  const autre = unites.find((u) => u.id !== uniteId && (u.code === c || u.code_interne === c));
  if (autre) return { ok: false, erreur: "stock_code_ambigu", message: `Le code « ${c} » désigne déjà une autre unité : un code ne peut identifier qu'une seule unité.` };
  return { ok: true };
}

/** Texte du QR code : UNIQUEMENT le code, aucune donnée personnelle. */
export function contenuQr(code: string): string {
  return code;
}
