import type { SupabaseClient } from "@supabase/supabase-js";
import { essaiTermine, estOffreGoNavigation } from "@/lib/go-navigation/offre";

export interface EtatOffre {
  /** Compte d'essai GO Navigation (organizations.offre = 'go_navigation'). */
  goNavigation: boolean;
  /** Essai GO Navigation terminé : accès bloqué, message « contactez GODAC ». */
  essaiTermine: boolean;
  trialEndsAt: string | null;
  country: string | null;
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
    const org = (error ? null : data) as { country?: string | null; offre?: string | null; subscription_status?: string | null; trial_ends_at?: string | null } | null;
    return {
      goNavigation: estOffreGoNavigation(org ? { offre: org.offre ?? null } : null),
      essaiTermine: essaiTermine(org ? { offre: org.offre ?? null, subscription_status: org.subscription_status ?? null, trial_ends_at: org.trial_ends_at ?? null } : null),
      trialEndsAt: org?.trial_ends_at ?? null,
      country: org?.country ?? null,
    };
  } catch (e) {
    console.error("lireEtatOffre: lecture impossible", e);
    return { goNavigation: false, essaiTermine: false, trialEndsAt: null, country: null };
  }
}
