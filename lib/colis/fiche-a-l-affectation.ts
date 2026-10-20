import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aujourdhuiParis } from "@/lib/colis/serveur";
import { choixRegroupement, ficheDeLAffectation, type Conducteur } from "@/lib/colis/fiche-du-jour";
import type { ChoixRequis, Regroupement } from "@/lib/colis/fiches-affectation";

/**
 * Fiche Tournée colis préparée quand l'encadrement affecte une tournée,
 * que ce soit depuis la Tournée colis (POST /api/colis/affectations) ou
 * depuis le Planning (POST /api/planning/entries). Un seul comportement :
 * - jour même ou à venir seulement (une date passée n'a pas de fiche) ;
 * - le chauffeur a déjà une affectation ou une fiche ouverte ce jour-là :
 *   on demande d'abord « séparées ou reliées » (réponse 409 choix_requis) ;
 * - puis fiche séparée (défaut) ou reliée, sans jamais annuler
 *   l'affectation si la fiche échoue.
 */

/** Une fiche colis se prépare pour aujourd'hui ou un jour à venir. */
export function ficheAPreparer(date: string): boolean {
  return date >= aujourdhuiParis();
}

/**
 * Question « séparées ou reliées » à poser avant d'inscrire l'affectation,
 * ou null (pas besoin, déjà répondu, ou vérification impossible : on
 * n'empêche jamais une affectation pour ça).
 */
export async function questionAvantAffectation(
  supabase: SupabaseClient,
  conducteur: Conducteur,
  date: string,
  regroupement: Regroupement | undefined,
  origine: string,
): Promise<Pick<ChoixRequis, "existantes" | "fiches_ouvertes"> | null> {
  if (regroupement || !ficheAPreparer(date)) return null;
  try {
    const choix = await choixRegroupement(supabase, conducteur, date);
    return choix?.requis ? { existantes: choix.existantes, fiches_ouvertes: choix.fiches_ouvertes } : null;
  } catch (e) {
    console.warn(`[${origine}] Choix séparée/reliée non vérifié`, { driverId: conducteur.id, date, error: e instanceof Error ? e.message : e });
    return null;
  }
}

/** Fiche colis de l'affectation qui vient d'être inscrite (jour même ou à venir). */
export async function ficheApresAffectation(
  supabase: SupabaseClient,
  conducteur: Conducteur,
  affectation: { id: string; tour_number: string; service_id: string | null; vehicle_id: string | null; start_at: string; status: string; created_at?: string | null },
  date: string,
  regroupement: Regroupement | undefined,
  origine: string,
): Promise<{ fiche: { id: string; name: string | null } | null; warning: string | null }> {
  if (!ficheAPreparer(date)) return { fiche: null, warning: null };
  try {
    const r = await ficheDeLAffectation(supabase, conducteur, { ...affectation, created_at: affectation.created_at ?? new Date().toISOString() }, date, regroupement ?? "separee");
    return { fiche: { id: r.run.id, name: r.run.name ?? null }, warning: r.warning ?? null };
  } catch (e) {
    console.error(`[${origine}] Fiche colis non créée`, { driverId: conducteur.id, date, error: e instanceof Error ? e.message : e });
    return {
      fiche: null,
      warning: "Tournée inscrite au planning, mais la fiche Tournée colis n'a pas pu être préparée : le chauffeur peut la créer avec « Nouvelle tournée ».",
    };
  }
}
