import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The tank's current weighted-average cost per litre (PMP), fed by
 * both deliveries (supabase/migrations/20260101000020_tank_deliveries.sql)
 * and prior fill-ups (the compute_fuel_entry_derived trigger) — see
 * fuel_price_history, the running trail both write to. A driver
 * filling from the company's own cuve has no way to know this price;
 * the server fills it in instead of asking (see app/api/fuel-entries).
 */
export async function getCurrentTankPmp(supabase: SupabaseClient, tankId: string): Promise<number | null> {
  const { data } = await supabase
    .from("fuel_price_history")
    .select("pmp_after")
    .eq("tank_id", tankId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.pmp_after !== undefined && data?.pmp_after !== null ? Number(data.pmp_after) : null;
}
