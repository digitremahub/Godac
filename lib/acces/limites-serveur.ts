import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { etatLimite, type EtatLimite } from "@/lib/acces/limites";

export interface LimiteVehicules extends EtatLimite {
  formule: string | null;
  nomFormule: string | null;
}

/**
 * Véhicules de l'organisation (toute la flotte, pas seulement le service
 * visible par un manager : compte fait avec le client admin) face au
 * `plans.vehicle_max` de sa formule.
 */
export async function limiteVehicules(organizationId: string, admin: SupabaseClient = createAdminSupabaseClient()): Promise<LimiteVehicules> {
  const { data: org } = await admin.from("organizations").select("plan").eq("id", organizationId).maybeSingle();
  const formule = (org?.plan as string | undefined) ?? null;
  const [{ data: plan }, { count }] = await Promise.all([
    formule ? admin.from("plans").select("name, vehicle_max").eq("id", formule).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("vehicles").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
  ]);
  const max = (plan as { vehicle_max: number | null } | null)?.vehicle_max ?? null;
  return { ...etatLimite(count ?? 0, max), formule, nomFormule: (plan as { name?: string } | null)?.name ?? formule };
}
