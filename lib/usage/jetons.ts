import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Consommation réelle des appels d'IA : jetons lus et écrits, et équivalent
 * en « unités » (1 unité = une lecture d'étiquette, le plus petit appel).
 * Information interne de suivi des coûts : les quotas, les plafonds et la
 * facturation du dépassement continuent de se baser sur `usage_events.units`
 * (aucun tarif ni volume affiché ne change).
 *
 * Fichier sans dépendance serveur : la partie calcul est testée dans
 * lib/usage/__tests__/jetons.test.ts.
 */

export interface JetonsConsommes {
  entree: number | null;
  sortie: number | null;
}

/** Jetons de sortie d'une lecture d'étiquette (max_tokens de l'appel de référence). */
const SORTIE_REFERENCE = 400;
/** Un jeton lu coûte environ cinq fois moins qu'un jeton écrit. */
const RAPPORT_ENTREE_SORTIE = 5;
/** Prix d'un jeton du modèle de lecture des documents par rapport au modèle des étiquettes (estimation, à ajuster après mesure). */
const COEFFICIENT_MODELE_DOCUMENT = 3;
const UNITES_REELLES_MAX = 100;

/** Équivalent en unités d'un appel de lecture de document (bordereau, rapport de tournée) ; au moins 1. */
export function unitesReelles(jetons: JetonsConsommes, coefficientModele: number = COEFFICIENT_MODELE_DOCUMENT): number {
  const entree = Math.max(0, jetons.entree ?? 0);
  const sortie = Math.max(0, jetons.sortie ?? 0);
  const brut = ((entree / RAPPORT_ENTREE_SORTIE + sortie) / SORTIE_REFERENCE) * coefficientModele;
  return Math.min(UNITES_REELLES_MAX, Math.max(1, Math.round(brut * 100) / 100));
}

/**
 * Ajoute les jetons à l'événement de consommation. Sans événement
 * (compteur indisponible) ou colonnes absentes (migration non appliquée) :
 * simple ligne de journal, jamais d'exception.
 */
export async function journaliserJetons(admin: SupabaseClient, eventId: string | null, fonction: string, jetons: JetonsConsommes): Promise<void> {
  const unites = unitesReelles(jetons);
  console.info(`ia: ${fonction} ${jetons.entree ?? "?"} jetons lus, ${jetons.sortie ?? "?"} écrits (≈ ${unites} unité${unites > 1 ? "s" : ""})`);
  if (!eventId) return;
  try {
    const { error } = await admin
      .from("usage_events")
      .update({ tokens_entree: jetons.entree, tokens_sortie: jetons.sortie, unites_reelles: unites })
      .eq("id", eventId);
    if (error && error.code !== "42703") console.warn("journaliserJetons: non enregistré", error.code ?? error.message);
  } catch (e) {
    console.warn("journaliserJetons: non enregistré", e instanceof Error ? e.message : e);
  }
}
