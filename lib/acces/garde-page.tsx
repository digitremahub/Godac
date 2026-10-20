import "server-only";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deciderAcces, ecran } from "@/lib/acces/catalogue";
import { modulesActifs, utilisateurCourant } from "@/lib/acces/modules-requete";
import { EtatAcces } from "@/components/acces/EtatAcces";

export type ResultatGarde =
  | { ok: true; appUser: AppUser; supabase: SupabaseClient; modules: ReadonlySet<string> }
  | { ok: false; ecran: React.ReactElement };

/**
 * Garde de page, une ligne en tête de chaque page de l'espace connecté :
 *
 *   const g = await garderPage("carburant.ticpe"); if (!g.ok) return g.ecran;
 *
 * Ordre : connexion (→ /onboarding, comme le layout), rôle (→ redirection
 * prévue par le catalogue, sinon <EtatAcces motif="role">), modules
 * (→ <EtatAcces motif="module">). Le pays (moduleDisponible) est déjà
 * appliqué par getEnabledModuleKeys.
 */
export async function garderPage(id: string): Promise<ResultatGarde> {
  const e = ecran(id);
  const appUser = await utilisateurCourant();
  if (!appUser) redirect("/onboarding");
  const modules = await modulesActifs(appUser.organization_id);
  const decision = deciderAcces(e, appUser.role, modules, appUser.conduit);
  if (!decision.ok) {
    if (decision.motif === "role") {
      if (decision.redirection) redirect(decision.redirection);
      return { ok: false, ecran: <EtatAcces motif="role" ecran={e.libelle} rolesAutorises={decision.rolesAutorises} conducteur={decision.conducteur} /> };
    }
    return {
      ok: false,
      ecran: <EtatAcces motif="module" ecran={e.libelle} modules={decision.modules} direction={appUser.role === "direction"} formuleMin={e.formuleMin} />,
    };
  }
  const supabase = await createServerSupabaseClient();
  return { ok: true, appUser, supabase, modules };
}
