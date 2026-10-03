import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The highest odometer reading on record for a vehicle, across every
 * source that can produce one (tours, maintenance-request readings,
 * and the baseline set when the vehicle entered GODAC). Not a pure
 * function — this is the data-access half that lib/business/odometer.ts's
 * checkOdometerNotRegressing() is deliberately kept out of, same split
 * as lib/organization/modules.ts vs. the pure checks it feeds.
 */
export async function getVehicleLastKnownKm(supabase: SupabaseClient, vehicleId: string): Promise<number | null> {
  const [{ data: vehicle }, { data: entries }, { data: interventions }] = await Promise.all([
    supabase.from("vehicles").select("initial_km").eq("id", vehicleId).single(),
    supabase.from("planning_entries").select("start_km, end_km").eq("vehicle_id", vehicleId),
    supabase.from("vehicle_interventions").select("odometer_km").eq("vehicle_id", vehicleId),
  ]);

  const readings: number[] = [];
  if (vehicle?.initial_km != null) readings.push(Number(vehicle.initial_km));
  for (const entry of entries ?? []) {
    if (entry.start_km != null) readings.push(Number(entry.start_km));
    if (entry.end_km != null) readings.push(Number(entry.end_km));
  }
  for (const intervention of interventions ?? []) {
    if (intervention.odometer_km != null) readings.push(Number(intervention.odometer_km));
  }

  return readings.length > 0 ? Math.max(...readings) : null;
}
