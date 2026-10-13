import type { SupabaseClient } from "@supabase/supabase-js";
import { moduleDisponible } from "@/lib/pays/pays";

async function paysOrganisation(supabase: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data } = await supabase.from("organizations").select("country").eq("id", organizationId).maybeSingle();
  return (data?.country as string | undefined) ?? null;
}

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
  const keys = (data ?? []).map((r) => r.module_key as string);
  // Modules propres au droit français (TICPE…) : masqués hors de France.
  if (keys.every((k) => moduleDisponible("BE", k))) return keys;
  const pays = await paysOrganisation(supabase, organizationId);
  return keys.filter((k) => moduleDisponible(pays, k));
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
  if (!data?.enabled) return false;
  return moduleDisponible("BE", moduleKey) || moduleDisponible(await paysOrganisation(supabase, organizationId), moduleKey);
}
