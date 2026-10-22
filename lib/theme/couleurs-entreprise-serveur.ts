import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { lireCouleursEntreprise, type CouleursEntreprise } from "@/lib/theme/couleurs-entreprise";

/**
 * Couleurs de l'entreprise (organizations.brand_colors) ; null = couleurs
 * GODAC. Tolérant tant que la migration 20261030000010 n'est pas appliquée.
 */
export async function couleursOrganisation(supabase: SupabaseClient, organizationId: string): Promise<CouleursEntreprise | null> {
  const { data, error } = await supabase.from("organizations").select("brand_colors").eq("id", organizationId).maybeSingle();
  if (error && !estSchemaManquant(error)) console.error("couleurs entreprise", error.message);
  return lireCouleursEntreprise((data as { brand_colors?: unknown } | null)?.brand_colors);
}
