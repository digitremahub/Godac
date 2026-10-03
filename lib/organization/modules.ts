import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves which module keys (supabase/migrations/20260101000015_module_catalog.sql)
 * an organisation currently has enabled. Reads the generic
 * `organization_modules` switchboard table — the single source of
 * truth for menu/feature gating, never the `modules` catalog table
 * directly (that one only describes what's sellable, not what a
 * given org actually has).
 */
export async function getEnabledModuleKeys(supabase: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("organization_modules")
    .select("module_key")
    .eq("organization_id", organizationId)
    .eq("enabled", true);
  if (error) throw error;
  return (data ?? []).map((r) => r.module_key as string);
}

/** Single-module check, for route guards that only care about one key (e.g. "ocr"). */
export async function isModuleEnabled(
  supabase: SupabaseClient,
  organizationId: string,
  moduleKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organization_modules")
    .select("enabled")
    .eq("organization_id", organizationId)
    .eq("module_key", moduleKey)
    .maybeSingle();
  if (error) throw error;
  return data?.enabled ?? false;
}
