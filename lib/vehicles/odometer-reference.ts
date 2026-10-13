import type { SupabaseClient } from "@supabase/supabase-js";

/** Pleins « de confiance » : saisis à la main ou ticket OCR validé. */
const TRUSTED_STATUSES = ["manual", "validated"];

/**
 * The highest odometer reading on record for a vehicle, across every
 * source that can produce one (tours, maintenance-request readings,
 * trusted fuel fill-ups, and the baseline set when the vehicle entered
 * GODAC). A ticket still awaiting OCR validation is left out: its
 * kilométrage hasn't been checked by anyone yet.
 * Not a pure function — this is the data-access half that
 * lib/business/odometer.ts's checkOdometerNotRegressing() is
 * deliberately kept out of, same split as lib/organization/modules.ts
 * vs. the pure checks it feeds.
 */
export async function getVehicleLastKnownKm(supabase: SupabaseClient, vehicleId: string): Promise<number | null> {
  const [{ data: vehicle }, { data: entries }, { data: interventions }, { data: fuelEntries }] = await Promise.all([
    supabase.from("vehicles").select("initial_km").eq("id", vehicleId).single(),
    supabase.from("planning_entries").select("start_km, end_km").eq("vehicle_id", vehicleId),
    supabase.from("vehicle_interventions").select("odometer_km").eq("vehicle_id", vehicleId),
    supabase.from("fuel_entries").select("vehicle_km").eq("vehicle_id", vehicleId).in("status", TRUSTED_STATUSES),
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
  for (const fuelEntry of fuelEntries ?? []) {
    if (fuelEntry.vehicle_km != null) readings.push(Number(fuelEntry.vehicle_km));
  }

  return readings.length > 0 ? Math.max(...readings) : null;
}

export interface DernierReleveKm {
  km: number;
  at: string;
  source: string;
}

/**
 * Kilométrage actuel affiché sur la fiche véhicule : le relevé le plus
 * récent en date (tournée, plein, intervention ou kilométrage initial),
 * avec sa date et son origine.
 */
export async function getVehicleLatestKmReading(supabase: SupabaseClient, vehicleId: string): Promise<DernierReleveKm | null> {
  const [{ data: vehicle }, { data: entries }, { data: interventions }, { data: fuelEntries }] = await Promise.all([
    supabase.from("vehicles").select("initial_km, created_at").eq("id", vehicleId).single(),
    supabase.from("planning_entries").select("tour_number, start_at, start_km, end_at, end_km").eq("vehicle_id", vehicleId).or("start_km.not.is.null,end_km.not.is.null"),
    supabase.from("vehicle_interventions").select("type, created_at, odometer_km").eq("vehicle_id", vehicleId).not("odometer_km", "is", null),
    supabase
      .from("fuel_entries")
      .select("occurred_at, vehicle_km")
      .eq("vehicle_id", vehicleId)
      .in("status", TRUSTED_STATUSES)
      .not("vehicle_km", "is", null),
  ]);

  const releves: DernierReleveKm[] = [];
  if (vehicle?.initial_km != null) releves.push({ km: Number(vehicle.initial_km), at: vehicle.created_at, source: "Kilométrage initial" });
  for (const e of entries ?? []) {
    if (e.start_km != null && e.start_at) releves.push({ km: Number(e.start_km), at: e.start_at, source: `Départ tournée n°${e.tour_number}` });
    if (e.end_km != null && e.end_at) releves.push({ km: Number(e.end_km), at: e.end_at, source: `Retour tournée n°${e.tour_number}` });
  }
  for (const i of interventions ?? []) releves.push({ km: Number(i.odometer_km), at: i.created_at, source: `Intervention : ${i.type}` });
  for (const f of fuelEntries ?? []) releves.push({ km: Number(f.vehicle_km), at: f.occurred_at, source: "Plein de carburant" });

  return dernierReleve(releves);
}

/** Le relevé le plus récent ; à date égale, le kilométrage le plus élevé. */
export function dernierReleve(releves: DernierReleveKm[]): DernierReleveKm | null {
  return releves.reduce<DernierReleveKm | null>((best, r) => {
    if (!best) return r;
    const d = Date.parse(r.at) - Date.parse(best.at);
    return d > 0 || (d === 0 && r.km > best.km) ? r : best;
  }, null);
}
