/**
 * Points relais dans la tournée colis.
 *
 * - Arrêt « point relais » (delivery_stops.kind = 'point_relais') : commerce
 *   partenaire où le chauffeur dépose plusieurs colis et reprend
 *   éventuellement des retours. Nom du relais dans relay_name, retours
 *   repris dans returns_count. Ses horaires viennent de l'annuaire des
 *   adresses pro (même adresse normalisée), comme pour toute adresse.
 * - Livraison remise au point relais en cas d'absence
 *   (delivered_place = 'point_relais') : nom ou adresse du relais dans
 *   relay_name, preuve par photo ou code du relais (proof_code).
 */
import { typeArret, type TypeArret } from "@/lib/colis/livraison";

/** Réseaux courants, proposés en suggestion du nom du relais. */
export const RESEAUX_RELAIS = ["Relais Colis", "Pickup", "Mondial Relay", "Chronopost Relais", "InPost", "Shop2Shop", "Colissimo Relais"] as const;

/** Longueur maximale du nom du relais (contrainte delivery_stops_relay_name_check). */
export const NOM_RELAIS_MAX = 200;
/** Nombre maximal de retours repris en un passage (contrainte delivery_stops_returns_count_check). */
export const RETOURS_MAX = 500;

/** Nom (ou adresse) du relais prêt à être enregistré : espaces normalisés, tronqué ; null si vide. */
export function normaliserNomRelais(brut: string | null | undefined): string | null {
  if (!brut) return null;
  const propre = brut
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return propre ? propre.slice(0, NOM_RELAIS_MAX) : null;
}

/** Retours repris saisis (« 3 », 3, « » …) → entier de 0 à RETOURS_MAX, ou null si illisible / vide. */
export function lireRetours(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(RETOURS_MAX, Math.floor(n));
}

/**
 * Regroupement d'un colis ajouté avec un arrêt existant à la même adresse :
 * renvoie le type de l'arrêt après regroupement, ou null s'ils restent deux
 * arrêts distincts.
 *
 * - Une ramasse ne se regroupe qu'avec une ramasse.
 * - Les colis à livrer (type par défaut du scan, de l'import et de la
 *   lecture d'étiquette) adressés au relais rejoignent l'arrêt point relais.
 * - Un point relais créé à l'adresse d'un arrêt de livraison le transforme
 *   en point relais (les colis déjà scannés y sont déposés).
 */
export function typeApresRegroupement(existant: TypeArret, ajoute: TypeArret): TypeArret | null {
  if (existant === "ramasse" || ajoute === "ramasse") return existant === ajoute ? "ramasse" : null;
  return existant === "point_relais" || ajoute === "point_relais" ? "point_relais" : "livraison";
}

/**
 * Arrêt existant que rejoint un colis ajouté : même liste, encore à faire,
 * même adresse normalisée et type compatible. Un arrêt point relais est
 * préféré à une livraison simple à la même adresse.
 */
export function arretARejoindre<T extends { status: string; list_id?: string | null; kind?: string | null; cle: string }>(
  stops: T[],
  cible: { listId: string | null; cle: string; type: TypeArret },
): T | null {
  const candidats = stops.filter(
    (s) => s.status === "pending" && (s.list_id ?? null) === cible.listId && s.cle === cible.cle && typeApresRegroupement(typeArret(s.kind), cible.type) !== null,
  );
  return candidats.find((s) => typeArret(s.kind) === "point_relais") ?? candidats[0] ?? null;
}
