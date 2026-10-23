import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compterUtilisateursLivreur } from "@/lib/organization/paliers-serveur";
import { lecturesInclusesLivreur } from "@/lib/usage/quotas";

/**
 * Lectures IA incluses grâce à l'application Livreur : nombre de chauffeurs
 * actifs × volume par chauffeur (lib/usage/quotas.ts). 0 si le module n'est
 * pas facturé au palier d'utilisateurs ou si le comptage échoue (le volume
 * de la formule s'applique alors seul : jamais bloquant, jamais plus
 * restrictif qu'avant).
 */
export async function lecturesInclusesOrganisation(admin: SupabaseClient, organizationId: string): Promise<number> {
  try {
    const { data } = await admin.from("organization_modules").select("module_key").eq("organization_id", organizationId).eq("module_key", "route_optimizer").eq("enabled", true).maybeSingle();
    if (!data) return 0;
    return lecturesInclusesLivreur(await compterUtilisateursLivreur(admin, organizationId));
  } catch (e) {
    console.error("lecturesInclusesOrganisation: comptage impossible", e);
    return 0;
  }
}
