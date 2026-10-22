import type { SupabaseClient } from "@supabase/supabase-js";
import { computeWindowConsumption, type FillUpPoint, type OdometerPoint } from "@/lib/business/consumption";
import { fetchAllRows } from "@/lib/utils/fetch-all";

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

/**
 * Classement de consommation (L/100 km) de toute une flotte en trois
 * requêtes au lieu de trois par véhicule (accueils manager, exploitation,
 * direction, comptable). Même calcul que getVehicleConsumption, véhicule
 * par véhicule, sur les mêmes sources.
 */
export async function getFleetConsumptionRanking(
  supabase: SupabaseClient,
  vehicles: readonly { id: string; registration: string }[],
  days: number,
  top = 5,
): Promise<{ registration: string; consumption: number }[]> {
  if (vehicles.length === 0) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceIso = since.toISOString();
  const ids = vehicles.map((v) => v.id);
  const filtreVehicules = ids.length <= 200;

  // Par flotte : la RLS limite déjà au périmètre (service du manager) ; le
  // filtre par identifiants n'est ajouté que tant que l'adresse reste courte.
  // Builders Supabase typés trop profondément pour TypeScript : lecture générique.
  type Lecture = PromiseLike<{ data: any[] | null; error: { message: string } | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parFlotte = (q: any) => (filtreVehicules ? q.in("vehicle_id", ids) : q.not("vehicle_id", "is", null));
  const parVehicule = <T extends { vehicle_id: string }>(rows: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.vehicle_id, [...(m.get(r.vehicle_id) ?? []), r]);
    return m;
  };
  const [fuel, tours, interventions] = await Promise.all([
    fetchAllRows<{ vehicle_id: string; liters: number | null; occurred_at: string; vehicle_km: number | null; product: string | null }>((a, b) => {
      const q = supabase.from("fuel_entries").select("vehicle_id, liters, occurred_at, vehicle_km, product").in("status", ["manual", "validated"]).gte("occurred_at", sinceIso);
      return parFlotte(q).order("id").range(a, b) as Lecture;
    }),
    fetchAllRows<{ vehicle_id: string; start_at: string | null; start_km: number | null; end_at: string | null; end_km: number | null }>((a, b) => {
      const q = supabase.from("planning_entries").select("vehicle_id, start_at, start_km, end_at, end_km").or(`start_at.gte.${sinceIso},end_at.gte.${sinceIso}`);
      return parFlotte(q).order("id").range(a, b) as Lecture;
    }),
    fetchAllRows<{ vehicle_id: string; created_at: string; odometer_km: number | null }>((a, b) => {
      const q = supabase.from("vehicle_interventions").select("vehicle_id, created_at, odometer_km").not("odometer_km", "is", null).gte("created_at", sinceIso);
      return parFlotte(q).order("id").range(a, b) as Lecture;
    }),
  ]);
  const fuelPar = parVehicule(fuel.rows);
  const toursPar = parVehicule(tours.rows);
  const interPar = parVehicule(interventions.rows);

  return vehicles
    .map((v) => {
      const readings: OdometerPoint[] = [];
      const fillUps: FillUpPoint[] = [];
      for (const t of toursPar.get(v.id) ?? []) {
        if (t.start_km != null && t.start_at) readings.push({ at: t.start_at, km: Number(t.start_km) });
        if (t.end_km != null && t.end_at) readings.push({ at: t.end_at, km: Number(t.end_km) });
      }
      for (const i of interPar.get(v.id) ?? []) readings.push({ at: i.created_at, km: Number(i.odometer_km) });
      for (const f of fuelPar.get(v.id) ?? []) {
        if (f.vehicle_km != null) readings.push({ at: f.occurred_at, km: Number(f.vehicle_km) });
        if ((f.product ?? "gazole") === "gazole") fillUps.push({ at: f.occurred_at, liters: Number(f.liters ?? 0) });
      }
      const windowReadings = readings.filter((r) => new Date(r.at) >= since);
      return { registration: v.registration, consumption: computeWindowConsumption(windowReadings, fillUps)?.lPer100Km ?? null };
    })
    .filter((v): v is { registration: string; consumption: number } => v.consumption !== null)
    .sort((a, b) => b.consumption - a.consumption)
    .slice(0, top);
}
