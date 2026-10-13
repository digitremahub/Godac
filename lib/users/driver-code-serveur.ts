import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeDriverCodeBase } from "@/lib/business/driver-code";

/**
 * Pose sur `users` le code de secours « initiales + mois/année de
 * naissance » (ex : FT1188), avec un suffixe -2, -3… en cas de collision
 * dans l'organisation (deux chauffeurs aux mêmes initiales nés le même
 * mois) — la colonne reste unique par organisation (migration 056).
 * Renvoie le code attribué.
 */
export async function assignDriverCodeFromBirthDate(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  fullName: string,
  birthDateISO: string,
): Promise<string> {
  const base = computeDriverCodeBase(fullName, birthDateISO);
  let candidate = base;
  let suffix = 2;
  // Boucle bornée : évite de tourner indéfiniment sur des données corrompues.
  for (let attempt = 0; attempt < 50; attempt++) {
    const { data: conflict } = await supabase
      .from("users")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("driver_code", candidate)
      .neq("id", userId)
      .maybeSingle();
    if (!conflict) break;
    candidate = `${base}-${suffix++}`;
  }
  await supabase.from("users").update({ driver_code: candidate }).eq("id", userId);
  return candidate;
}
