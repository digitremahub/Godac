import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FineMatchCandidate {
  planningEntryId: string;
  driverId: string;
  driverName: string;
  tourNumber: string;
  startAt: string;
  endAt: string | null;
}

/**
 * Suggests who was driving a vehicle at the moment of an infraction —
 * a tour whose scan-stamped window (start_at..end_at, see
 * app/api/tours/route.ts) covers infraction_at. Deliberately only a
 * suggestion: app/api/fines never writes driver_id from this directly,
 * direction confirms it first (see app/api/fines/[id]/route.ts).
 * Still in progress (no end_at yet) counts too, since an infraction
 * can land before the driver has scanned back in.
 */
export async function findFineMatchCandidate(
  supabase: SupabaseClient,
  params: { vehicleId: string; infractionAt: string },
): Promise<FineMatchCandidate | null> {
  const { data } = await supabase
    .from("planning_entries")
    .select("id, tour_number, start_at, end_at, driver_id, users!planning_entries_driver_id_fkey(full_name)")
    .eq("vehicle_id", params.vehicleId)
    .in("status", ["in_progress", "done"])
    .not("driver_id", "is", null)
    .lte("start_at", params.infractionAt)
    .or(`end_at.is.null,end_at.gte.${params.infractionAt}`)
    .order("start_at", { ascending: false })
    .limit(1);

  const row = (data ?? [])[0] as any;
  if (!row || !row.driver_id) return null;

  return {
    planningEntryId: row.id,
    driverId: row.driver_id,
    driverName: row.users?.full_name ?? "—",
    tourNumber: row.tour_number,
    startAt: row.start_at,
    endAt: row.end_at,
  };
}
