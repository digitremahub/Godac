import type { SupabaseClient } from "@supabase/supabase-js";
import { computeConsumptionLPer100Km, computeKmTraveled, type OdometerPoint } from "@/lib/business/consumption";

/**
 * L/100km for a vehicle over the last `days` days. Not pure — gathers
 * diesel liters and odometer readings from the database before
 * handing them to lib/business/consumption.ts's pure functions, same
 * split as lib/vehicles/odometer-reference.ts.
 */
export async function getVehicleConsumption(
  supabase: SupabaseClient,
  vehicleId: string,
  days: number,
): Promise<number | null> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();

  const [{ data: fuelRows }, { data: tours }, { data: interventions }] = await Promise.all([
    supabase
      .from("fuel_entries")
      .select("liters, occurred_at, tanks(fuel_type)")
      .eq("vehicle_id", vehicleId)
      .in("status", ["manual", "validated"])
      .gte("occurred_at", sinceIso),
    supabase.from("planning_entries").select("start_at, start_km, end_at, end_km").eq("vehicle_id", vehicleId),
    supabase.from("vehicle_interventions").select("created_at, odometer_km").eq("vehicle_id", vehicleId).not("odometer_km", "is", null),
  ]);

  const liters = (fuelRows ?? [])
    .filter((r: any) => r.tanks?.fuel_type === "diesel")
    .reduce((sum: number, r: any) => sum + Number(r.liters ?? 0), 0);

  const readings: OdometerPoint[] = [];
  for (const t of (tours ?? []) as any[]) {
    if (t.start_km != null && t.start_at) readings.push({ at: t.start_at, km: Number(t.start_km) });
    if (t.end_km != null && t.end_at) readings.push({ at: t.end_at, km: Number(t.end_km) });
  }
  for (const i of (interventions ?? []) as any[]) {
    readings.push({ at: i.created_at, km: Number(i.odometer_km) });
  }
  const windowReadings = readings.filter((r) => new Date(r.at) >= since);

  return computeConsumptionLPer100Km(liters, computeKmTraveled(windowReadings));
}
