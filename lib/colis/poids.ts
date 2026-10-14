/**
 * Poids des colis (en kg) : lu sur l'étiquette (photo ou code scanné),
 * saisi ou corrigé par le chauffeur, totalisé par tournée et par liste.
 */

/** Poids maximal accepté pour un arrêt (contrainte delivery_stops_weight_kg_check). */
export const POIDS_MAX_KG = 10_000;

const arrondi = (kg: number) => Math.round(kg * 1000) / 1000;

/**
 * Poids en kg depuis un nombre (déjà en kg) ou un texte : « 2,5 kg »,
 * « 850 g », « 1.2 KGS », « 3 » (kg). null si absent, nul ou aberrant.
 */
export function lirePoids(v: unknown): number | null {
  let kg: number | null = null;
  if (typeof v === "number") kg = v;
  else if (typeof v === "string") {
    const m = v
      .trim()
      .toLowerCase()
      .replace(/(\d)\s+(?=\d{3}\b)/g, "$1")
      .match(/^(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|kilogrammes?|g|gr|grammes?)?\.?$/);
    if (m) {
      const n = Number(m[1]!.replace(",", "."));
      kg = m[2] && /^g/.test(m[2]) ? n / 1000 : n;
    }
  }
  if (kg === null || !Number.isFinite(kg) || kg <= 0 || kg > POIDS_MAX_KG) return null;
  return arrondi(kg);
}

/** Premier poids écrit dans un texte d'étiquette (« Poids : 2,3 kg », « Weight 850 g »). */
export function extrairePoids(texte: string | null | undefined): number | null {
  if (!texte) return null;
  const m = texte.match(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|g|gr)\b/i);
  return m ? lirePoids(`${m[1]} ${m[2]}`) : null;
}

/** « 2,5 kg » ; « 0,85 kg » ; null → null. */
export function formatPoids(kg: number | string | null | undefined): string | null {
  const n = kg === null || kg === undefined || kg === "" ? NaN : Number(kg);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: n < 10 ? 2 : 1 }).format(n)} kg`;
}

/** Total des poids connus ; null si aucun arrêt n'a de poids. */
export function sommePoids(stops: { weight_kg?: number | string | null }[]): number | null {
  let total = 0;
  let connu = false;
  for (const s of stops) {
    const n = s.weight_kg === null || s.weight_kg === undefined ? NaN : Number(s.weight_kg);
    if (Number.isFinite(n) && n > 0) {
      total += n;
      connu = true;
    }
  }
  return connu ? arrondi(total) : null;
}
