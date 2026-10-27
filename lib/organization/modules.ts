import type { SupabaseClient } from "@supabase/supabase-js";
import { moduleDisponible } from "@/lib/pays/pays";
import { lireEtatOffre, type EtatOffre } from "@/lib/go-navigation/etat";

/**
 * Resolves which module keys (supabase/migrations/20260101000015_module_catalog.sql)
 * an organisation currently has enabled. Reads the generic
 * `organization_modules` switchboard table — the single source of
 * truth for menu/feature gating, never the `modules` catalog table
 * directly (that one only describes what's sellable, not what a
 * given org actually has).
 *
 * Essai GO Navigation terminé (lib/go-navigation/offre.ts) : aucun
 * module actif, donc toutes les fonctions gardées par module sont
 * bloquées jusqu'au passage sur une vraie offre.
 */
export async function getEnabledModuleKeys(supabase: SupabaseClient, organizationId: string): Promise<string[]> {
  return (await getEtatModules(supabase, organizationId)).cles;
}

/** Modules actifs et état de l'offre (GO Navigation, fin d'essai), en deux lectures parallèles. */
export async function getEtatModules(supabase: SupabaseClient, organizationId: string): Promise<{ cles: string[]; offre: EtatOffre }> {
  const [{ data, error }, offre] = await Promise.all([
    supabase.from("organization_modules").select("module_key").eq("organization_id", organizationId).eq("enabled", true),
    lireEtatOffre(supabase, organizationId),
  ]);
  if (error) throw error;
  if (offre.essaiTermine || offre.indetermine) return { cles: [], offre };
  const keys = (data ?? []).map((r) => r.module_key as string);
  // Modules propres au droit français (TICPE…) : masqués hors de France.
  return { cles: keys.filter((k) => moduleDisponible(offre.country, k)), offre };
}

/** Single-module check, for route guards that only care about one key (e.g. "ocr"). */
export async function isModuleEnabled(
  supabase: SupabaseClient,
  organizationId: string,
  moduleKey: string,
): Promise<boolean> {
  const [{ data, error }, offre] = await Promise.all([
    supabase.from("organization_modules").select("enabled").eq("organization_id", organizationId).eq("module_key", moduleKey).maybeSingle(),
    lireEtatOffre(supabase, organizationId),
  ]);
  if (error) throw error;
  if (!data?.enabled || offre.essaiTermine || offre.indetermine) return false;
  return moduleDisponible(offre.country, moduleKey);
}
