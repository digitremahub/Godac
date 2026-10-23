import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Historique : levait une alerte « chauffeur déjà affecté au même
 * horaire ». Un chauffeur peut avoir DEUX tournées à la même heure
 * (combiné, certains jours) : ce n'est plus un conflit. La fonction est
 * conservée pour ses appelants et ne signale plus rien.
 */
export async function warnIfDriverDoubleBooked(
  _supabase: SupabaseClient,
  _params: { organizationId: string; driverId: string; startAt: string; excludeEntryId: string },
): Promise<string | null> {
  return null;
}
