import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Non-blocking flag (same convention as warnIfDriverDoubleBooked) —
 * raised when a driver starts a tour with a different vehicle than
 * the one a manager planned. No recipient_roles override, so the
 * webhook (app/api/webhooks/supabase-alerts) falls back to notifying
 * direction, same as every other alert here that doesn't target a
 * specific person or role.
 */
export async function reportVehicleSwap(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    plannedEntryId: string;
    plannedVehicleId: string;
    actualVehicleId: string;
    reason: string;
    /** "départ" (default, swap vs. the manager's plan) or "retour" (swap vs. the vehicle scanned at departure). */
    stage?: "départ" | "retour";
  },
): Promise<string> {
  const [{ data: planned }, { data: actual }] = await Promise.all([
    supabase.from("vehicles").select("registration").eq("id", params.plannedVehicleId).single(),
    supabase.from("vehicles").select("registration").eq("id", params.actualVehicleId).single(),
  ]);

  const stage = params.stage ?? "départ";
  const message = `Changement de véhicule au ${stage} : ${stage === "départ" ? "prévu" : "parti avec"} ${planned?.registration ?? "?"}, ${stage === "départ" ? "utilisé" : "revenu avec"} ${actual?.registration ?? "?"} — motif : ${params.reason}`;

  await supabase.from("alerts").insert({
    organization_id: params.organizationId,
    type: "vehicle_swap",
    severity: "warning",
    message,
    related_table: "planning_entries",
    related_id: params.plannedEntryId,
  });

  return message;
}
