import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PMP (prix moyen pondéré) courant d'une cuve, porté par tanks.pmp et
 * recalculé à chaque livraison par le trigger before_tank_delivery
 * (migration 121) : (stock⁺ × PMP + litres livrés × prix) / (stock⁺ +
 * litres livrés). Un plein à la cuve ne le modifie pas : il est valorisé
 * à ce prix. Le chauffeur n'a jamais à connaître ce prix.
 */
export async function getCurrentTankPmp(supabase: SupabaseClient, tankId: string): Promise<number | null> {
  const { data } = await supabase.from("tanks").select("pmp").eq("id", tankId).maybeSingle();
  return data?.pmp !== undefined && data?.pmp !== null ? Number(data.pmp) : null;
}
