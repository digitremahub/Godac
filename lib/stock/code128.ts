/**
 * Encodeur Code 128 (ISO/IEC 15417), jeux B et C, écrit sans dépendance (fichier
 * pur, testé sur vecteurs de référence dans lib/stock/__tests__/code128.test.ts).
 *
 *   * Jeu B : ASCII 32 à 126 (lettres, chiffres, ponctuation).
 *   * Jeu C : paires de chiffres (compacte les numéros : « 2026 » = 2 symboles).
 *   * Le choix et les changements de jeu minimisent le nombre de symboles
 *     (programmation dynamique) : « TRA-2026-000012 » démarre en B, passe en C
 *     pour « 2026 » puis pour « 000012 ».
 *   * Somme de contrôle : (symbole de départ + Σ position × valeur) modulo 103.
 *   * Zone de silence (quiet zone) : 10 modules blancs de chaque côté.
 *
 * Un module = la plus petite largeur de barre. Un symbole = 11 modules
 * (6 éléments alternant barre / espace), l'arrêt = 13 modules.
 */

/** Largeurs des éléments (barre, espace, barre, espace, barre, espace) des symboles 0 à 106. */
export const MOTIFS_CODE128: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

export const CODE_B = 100; // changement vers le jeu B (depuis C)
export const CODE_C = 99; // changement vers le jeu C (depuis B)
export const DEPART_B = 104;
export const DEPART_C = 105;
export const ARRET = 106;
/** Zone de silence de chaque côté, en modules. */
export const ZONE_SILENCE_MODULES = 10;
export const LONGUEUR_MAX_CODE128 = 80;

export class ErreurCode128 extends Error {}

export type JeuCode128 = "B" | "C";

export interface CodeBarres128 {
  texte: string;
  /** Valeurs des symboles, départ en tête, somme de contrôle en avant-dernière position, arrêt en dernière. */
  symboles: number[];
  controle: number;
  /** Jeu de départ. */
  depart: JeuCode128;
  /** Suite de modules (« 1 » = barre, « 0 » = espace), arrêt compris, SANS zone de silence. */
  modules: string;
  /** Nombre total de modules avec la zone de silence de chaque côté. */
  largeurModules: number;
}

/** Texte encodable en jeu B ? (ASCII imprimable). */
export function encodable128(texte: string): boolean {
  return texte.length > 0 && texte.length <= LONGUEUR_MAX_CODE128 && /^[ -~]+$/.test(texte);
}

const estChiffre = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * Découpe optimale en symboles : [départ, ...données]. Coût = nombre de symboles
 * (départ, changements de jeu et caractères / paires). Le jeu C n'accepte que des
 * paires de chiffres.
 */
export function symbolesCode128(texte: string): number[] {
  if (!encodable128(texte)) throw new ErreurCode128("Texte non encodable en Code 128 (ASCII 32 à 126, 80 caractères au plus).");
  const n = texte.length;
  const INF = 1e9;
  const paireEn = (i: number) => estChiffre(texte[i]) && estChiffre(texte[i + 1]);
  // fB[i] / fC[i] : coût minimal de texte[i..] en étant déjà dans le jeu B / C. Un changement n'est jamais suivi d'un autre changement.
  const fB: number[] = new Array(n + 1).fill(0);
  const fC: number[] = new Array(n + 1).fill(0);
  const ecritB: number[] = new Array(n + 1).fill(0);
  const ecritC: number[] = new Array(n + 1).fill(INF);
  for (let i = n - 1; i >= 0; i--) {
    ecritB[i] = 1 + fB[i + 1]!;
    ecritC[i] = paireEn(i) ? 1 + fC[i + 2]! : INF;
    fB[i] = Math.min(ecritB[i]!, 1 + ecritC[i]!);
    fC[i] = Math.min(ecritC[i]!, 1 + ecritB[i]!);
  }
  const departC = paireEn(0) && ecritC[0]! < ecritB[0]!;
  const sortie: number[] = [departC ? DEPART_C : DEPART_B];
  let jeu: JeuCode128 = departC ? "C" : "B";
  let i = 0;
  while (i < n) {
    if (jeu === "B") {
      if (ecritB[i]! <= 1 + ecritC[i]!) {
        sortie.push(texte.charCodeAt(i) - 32);
        i += 1;
      } else {
        sortie.push(CODE_C);
        jeu = "C";
      }
    } else if (ecritC[i]! <= 1 + ecritB[i]!) {
      sortie.push(Number(texte.slice(i, i + 2)));
      i += 2;
    } else {
      sortie.push(CODE_B);
      jeu = "B";
    }
  }
  return sortie;
}

/** Somme de contrôle : (départ + Σ rang × valeur) modulo 103, rang à partir de 1 pour le premier symbole de données. */
export function controleCode128(symboles: readonly number[]): number {
  let somme = symboles[0] ?? 0;
  for (let k = 1; k < symboles.length; k++) somme += k * symboles[k]!;
  return somme % 103;
}

/** Modules (« 1 » barre, « 0 » espace) d'une suite de symboles. */
export function modulesDeSymboles(symboles: readonly number[]): string {
  let bits = "";
  for (const s of symboles) {
    const motif = MOTIFS_CODE128[s];
    if (!motif) throw new ErreurCode128(`Symbole inconnu : ${s}`);
    let barre = true;
    for (const largeur of motif) {
      bits += (barre ? "1" : "0").repeat(Number(largeur));
      barre = !barre;
    }
  }
  return bits;
}

/** Encode un texte en Code 128 (jeux B et C choisis automatiquement). */
export function encoderCode128(texte: string): CodeBarres128 {
  const donnees = symbolesCode128(texte);
  const controle = controleCode128(donnees);
  const symboles = [...donnees, controle, ARRET];
  const modules = modulesDeSymboles(symboles);
  return {
    texte,
    symboles,
    controle,
    depart: donnees[0] === DEPART_C ? "C" : "B",
    modules,
    largeurModules: modules.length + 2 * ZONE_SILENCE_MODULES,
  };
}

/** Barres sous forme de segments {x, largeur} en modules, zone de silence comprise dans x. */
export function barresCode128(code: CodeBarres128): { x: number; largeur: number }[] {
  const barres: { x: number; largeur: number }[] = [];
  const m = code.modules;
  let i = 0;
  while (i < m.length) {
    if (m[i] === "1") {
      let j = i;
      while (j < m.length && m[j] === "1") j++;
      barres.push({ x: ZONE_SILENCE_MODULES + i, largeur: j - i });
      i = j;
    } else i++;
  }
  return barres;
}

/**
 * Décodage de contrôle (utilisé par les tests et pour vérifier un code imprimé) :
 * retrouve le texte à partir des symboles, contrôle la somme et l'arrêt.
 */
export function decoderSymboles(symboles: readonly number[]): string {
  const depart = symboles[0];
  if (depart !== DEPART_B && depart !== DEPART_C) throw new ErreurCode128("Symbole de départ invalide.");
  if (symboles[symboles.length - 1] !== ARRET) throw new ErreurCode128("Arrêt manquant.");
  const donnees = symboles.slice(0, -2);
  if (controleCode128(donnees) !== symboles[symboles.length - 2]) throw new ErreurCode128("Somme de contrôle invalide.");
  let jeu: JeuCode128 = depart === DEPART_C ? "C" : "B";
  let texte = "";
  for (const s of donnees.slice(1)) {
    if (jeu === "B" && s === CODE_C) jeu = "C";
    else if (jeu === "C" && s === CODE_B) jeu = "B";
    else if (jeu === "B") texte += String.fromCharCode(s + 32);
    else texte += String(s).padStart(2, "0");
  }
  return texte;
}
