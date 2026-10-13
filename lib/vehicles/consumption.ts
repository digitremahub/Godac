import type { SupabaseClient } from "@supabase/supabase-js";
import { computeWindowConsumption, type FillUpPoint, type OdometerPoint } from "@/lib/business/consumption";

/**
 * L/100km for a vehicle over the last `days` days. Not pure — gathers
 * odometer readings and trusted gazole fill-ups from the database
 * before handing them to lib/business/consumption.ts's
 * computeWindowConsumption, same split as
 * lib/vehicles/odometer-reference.ts. Station purchases count too
 * (product = 'gazole', not the tank's fuel type: they have no tank).
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
      .select("liters, occurred_at, vehicle_km, product")
      .eq("vehicle_id", vehicleId)
      .in("status", ["manual", "validated"])
      .gte("occurred_at", sinceIso),
    supabase
      .from("planning_entries")
      .select("start_at, start_km, end_at, end_km")
      .eq("vehicle_id", vehicleId)
      .or(`start_at.gte.${sinceIso},end_at.gte.${sinceIso}`),
    supabase
      .from("vehicle_interventions")
      .select("created_at, odometer_km")
      .eq("vehicle_id", vehicleId)
      .not("odometer_km", "is", null)
      .gte("created_at", sinceIso),
  ]);

  const readings: OdometerPoint[] = [];
  const fillUps: FillUpPoint[] = [];
  for (const t of (tours ?? []) as any[]) {
    if (t.start_km != null && t.start_at) readings.push({ at: t.start_at, km: Number(t.start_km) });
    if (t.end_km != null && t.end_at) readings.push({ at: t.end_at, km: Number(t.end_km) });
  }
  for (const i of (interventions ?? []) as any[]) {
    readings.push({ at: i.created_at, km: Number(i.odometer_km) });
  }
  for (const f of (fuelRows ?? []) as any[]) {
    if (f.vehicle_km != null) readings.push({ at: f.occurred_at, km: Number(f.vehicle_km) });
    if ((f.product ?? "gazole") === "gazole") fillUps.push({ at: f.occurred_at, liters: Number(f.liters ?? 0) });
  }
  const windowReadings = readings.filter((r) => new Date(r.at) >= since);

  return computeWindowConsumption(windowReadings, fillUps)?.lPer100Km ?? null;
}
