import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Plan, ModuleCatalogEntry, ModulePlanPrice } from "@/lib/organization/catalog-types";

export type { PlanId, ModuleWave, Plan, ModuleCatalogEntry, ModulePlanPrice } from "@/lib/organization/catalog-types";
export { priceFor } from "@/lib/organization/catalog-types";

/**
 * Data-driven module catalog (supabase/migrations/20260101000015_module_catalog.sql)
 * — these three tables are the single source of truth for what
 * GODAC sells and at what price. Public read access (no auth
 * required), used by both the /modules marketing page and the
 * onboarding flow.
 */
export async function getPlans(supabase: SupabaseClient): Promise<Plan[]> {
  const { data, error } = await supabase.from("plans").select("*").order("sort_order");
  if (error) throw error;
  return data as Plan[];
}

export async function getModules(supabase: SupabaseClient): Promise<ModuleCatalogEntry[]> {
  const { data, error } = await supabase.from("modules").select("*").order("sort_order");
  if (error) throw error;
  return data as ModuleCatalogEntry[];
}

export async function getModulePlanPrices(supabase: SupabaseClient): Promise<ModulePlanPrice[]> {
  const { data, error } = await supabase.from("module_plan_prices").select("*");
  if (error) throw error;
  return data as ModulePlanPrice[];
}

/** Convenience: the full catalog in one round trip, for pages that need all three. */
export async function getFullCatalog(supabase: SupabaseClient) {
  const [plans, modules, prices] = await Promise.all([
    getPlans(supabase),
    getModules(supabase),
    getModulePlanPrices(supabase),
  ]);
  return { plans, modules, prices };
}
