import type { SupabaseClient } from "@supabase/supabase-js";
import { essaiTermine, estOffreGoNavigation } from "@/lib/go-navigation/offre";

export interface EtatOffre {
  /** Compte d'essai GO Navigation (organizations.offre = 'go_navigation'). */
  goNavigation: boolean;
  /** Essai GO Navigation terminé : accès bloqué, message « contactez GODAC ». */
  essaiTermine: boolean;
  trialEndsAt: string | null;
  country: string | null;
  /**
   * Lecture impossible et aucune valeur récente en mémoire : l'offre est
   * inconnue. Les accès gardés par module sont refusés (fail-closed) pour
   * qu'un incident base ne permette pas de passer outre la fin d'un essai.
   */
  indetermine?: boolean;
}

/** Durée pendant laquelle le dernier état lu sert de repli quand la lecture échoue. */
export const VALIDITE_ETAT_CONNU_MS = 10 * 60_000;

/** Dernier état lu avec succès, par organisation (mémoire de l'instance). */
const etatsConnus = new Map<string, { etat: EtatOffre; lu: number }>();

/** Repli quand la lecture échoue (pur) : dernier état connu s'il est récent, sinon offre indéterminée. */
export function etatEnCasDeLecture(connu: { etat: EtatOffre; lu: number } | undefined, maintenant: number = Date.now()): EtatOffre {
  if (connu && maintenant - connu.lu <= VALIDITE_ETAT_CONNU_MS) return connu.etat;
  return { goNavigation: false, essaiTermine: false, trialEndsAt: null, country: null, indetermine: true };
}

/**
 * Offre, fin d'essai et pays de l'organisation, en une lecture. Colonne
 * `offre` absente (migration 20261023000003 pas encore appliquée) : relit
 * sans elle, l'organisation est alors traitée comme une offre classique.
 */
export async function lireEtatOffre(supabase: SupabaseClient, organizationId: string): Promise<EtatOffre> {
  try {
    const lire = (colonnes: string) => supabase.from("organizations").select(colonnes).eq("id", organizationId).maybeSingle<Record<string, unknown>>();
    let { data, error } = await lire("country, offre, subscription_status, trial_ends_at");
    if (error?.code === "42703") ({ data, error } = await lire("country"));
    if (error && error.code !== "42703") throw error;
    const org = (error ? null : data) as { country?: string | null; offre?: string | null; subscription_status?: string | null; trial_ends_at?: string | null } | null;
    const etat: EtatOffre = {
      goNavigation: estOffreGoNavigation(org ? { offre: org.offre ?? null } : null),
      essaiTermine: essaiTermine(org ? { offre: org.offre ?? null, subscription_status: org.subscription_status ?? null, trial_ends_at: org.trial_ends_at ?? null } : null),
      trialEndsAt: org?.trial_ends_at ?? null,
      country: org?.country ?? null,
    };
    etatsConnus.set(organizationId, { etat, lu: Date.now() });
    return etat;
  } catch (e) {
    const etat = etatEnCasDeLecture(etatsConnus.get(organizationId));
    console.error(`lireEtatOffre: lecture impossible, ${etat.indetermine ? "accès gardés par module refusés" : "dernier état connu utilisé"}`, e);
    return etat;
  }
}
