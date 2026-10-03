import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findDriverTimeConflicts } from "@/lib/business/planning-conflict";

/**
 * Runs the pure findDriverTimeConflicts check against the driver's
 * real schedule and, if it finds a collision, raises a non-blocking
 * 'planning_conflict' alert (same "flag, don't block" convention as
 * leave overlap) and returns a message the caller can also hand back
 * in its own API response so the UI can show it inline right away,
 * without waiting for the alert center.
 */
export async function warnIfDriverDoubleBooked(
  supabase: SupabaseClient,
  params: { organizationId: string; driverId: string; startAt: string; excludeEntryId: string },
): Promise<string | null> {
  const { data } = await supabase
    .from("planning_entries")
    .select("id, start_at, status, tour_number, services(name)")
    .eq("driver_id", params.driverId)
    .eq("start_at", params.startAt)
    .in("status", ["planned", "in_progress"]);

  const conflicts = findDriverTimeConflicts(
    { entryId: params.excludeEntryId, startAt: params.startAt, status: "planned" },
    (data ?? []).map((e: any) => ({ entryId: e.id, startAt: e.start_at, status: e.status, tourNumber: e.tour_number, service: e.services?.name })),
  ) as unknown as { entryId: string; tourNumber: string; service: string | null }[];

  if (conflicts.length === 0) return null;

  const message = `Chauffeur déjà affecté au même horaire : ${conflicts
    .map((c) => `n°${c.tourNumber}${c.service ? ` (${c.service})` : ""}`)
    .join(", ")}.`;

  await supabase.from("alerts").insert({
    organization_id: params.organizationId,
    type: "planning_conflict",
    severity: "warning",
    message,
    related_table: "planning_entries",
    related_id: params.excludeEntryId,
  });

  return message;
}
