import "server-only";
import { cache } from "react";
import { getCurrentAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getEtatModules } from "@/lib/organization/modules";
import { DROIT_PARTAGE_GO, MARQUEUR_GO_NAVIGATION } from "@/lib/acces/catalogue";
import { lireDroitPartage } from "@/lib/partage-go/serveur";

/**
 * Utilisateur courant et modules actifs, chargés UNE fois par requête
 * (cache() de React) : le layout, la garde de page et la page elle-même
 * partagent le même résultat au lieu de multiplier les isModuleEnabled.
 */
export const utilisateurCourant = cache(async () => getCurrentAppUser());

export const modulesActifs = cache(async (organizationId: string): Promise<ReadonlySet<string>> => {
  return (await etatModulesCourant(organizationId)).modules;
});

/**
 * Modules actifs + état de l'offre. Compte GO Navigation : le marqueur
 * MARQUEUR_GO_NAVIGATION est ajouté à l'ensemble, pour que le menu, les
 * onglets et la garde de page se limitent aux écrans GO Navigation.
 * Personne autorisée à faire essayer GO : DROIT_PARTAGE_GO est ajouté.
 */
export const etatModulesCourant = cache(async (organizationId: string) => {
  const supabase = await createServerSupabaseClient();
  const { cles, offre } = await getEtatModules(supabase, organizationId);
  const ensemble = new Set(offre.goNavigation ? [...cles, MARQUEUR_GO_NAVIGATION] : cles);
  // « Faire essayer GO » : droit par personne (direction, désignés, ou toute l'équipe).
  if (!offre.goNavigation && !offre.essaiTermine) {
    const appUser = await utilisateurCourant();
    if (appUser && appUser.organization_id === organizationId) {
      const droit = await lireDroitPartage(supabase, { userId: appUser.id, organizationId, role: appUser.role, goNavigation: false });
      if (droit.autorise) ensemble.add(DROIT_PARTAGE_GO);
    }
  }
  const modules: ReadonlySet<string> = ensemble;
  return { modules, offre };
});
