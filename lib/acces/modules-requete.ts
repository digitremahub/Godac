import "server-only";
import { cache } from "react";
import { getCurrentAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getEnabledModuleKeys } from "@/lib/organization/modules";

/**
 * Utilisateur courant et modules actifs, chargés UNE fois par requête
 * (cache() de React) : le layout, la garde de page et la page elle-même
 * partagent le même résultat au lieu de multiplier les isModuleEnabled.
 */
export const utilisateurCourant = cache(async () => getCurrentAppUser());

export const modulesActifs = cache(async (organizationId: string): Promise<ReadonlySet<string>> => {
  const supabase = await createServerSupabaseClient();
  return new Set(await getEnabledModuleKeys(supabase, organizationId));
});
