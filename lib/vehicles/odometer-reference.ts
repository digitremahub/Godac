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

export interface RelevesEncadrants {
  /** Dernier relevé à la date du plein ou avant. */
  avant: DernierReleveKm | null;
  /** Premier relevé après la date du plein (saisie rétroactive). */
  apres: DernierReleveKm | null;
}

/** Le relevé le plus ancien ; à date égale, le kilométrage le plus bas. */
export function premierReleve(releves: DernierReleveKm[]): DernierReleveKm | null {
  return releves.reduce<DernierReleveKm | null>((best, r) => {
    if (!best) return r;
    const d = Date.parse(r.at) - Date.parse(best.at);
    return d < 0 || (d === 0 && r.km < best.km) ? r : best;
  }, null);
}

/**
 * Relevés kilométriques qui encadrent la date réelle d'un plein. Un plein
 * saisi le 12 octobre est comparé au dernier relevé connu au 12 (plancher)
 * et au premier relevé postérieur (plafond) : un kilométrage supérieur à
 * celui du 15 octobre est aussi incohérent qu'un recul.
 *
 * Une requête `order().limit(1)` par source et par sens, au lieu de relire
 * tout l'historique du véhicule. Le client doit voir toutes les tournées du
 * véhicule (client admin, véhicule déjà vérifié dans l'organisation) : avec
 * la RLS, un chauffeur ne verrait que ses propres tournées.
 */
export async function getVehicleKmReadingsAround(
  supabase: SupabaseClient,
  vehicleId: string,
  occurredAt: string,
): Promise<RelevesEncadrants> {
  const iso = new Date(occurredAt).toISOString();
  type Ligne = Record<string, unknown>;
  /** Un relevé par source, le plus proche de la date du plein, d'un côté ou de l'autre. */
  const proche = async (table: string, colonnes: string, colonneDate: string, colonneKm: string, avant: boolean, statuts?: string[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from(table).select(colonnes).eq("vehicle_id", vehicleId).not(colonneKm, "is", null);
    if (statuts) q = q.in("status", statuts);
    q = avant ? q.lte(colonneDate, iso) : q.gt(colonneDate, iso);
    const { data } = await q.order(colonneDate, { ascending: !avant }).limit(1);
    return ((data ?? []) as Ligne[])[0] ?? null;
  };
  const sens = async (avant: boolean): Promise<DernierReleveKm[]> => {
    const [depart, retour, intervention, plein] = await Promise.all([
      proche("planning_entries", "tour_number, start_at, start_km", "start_at", "start_km", avant),
      proche("planning_entries", "tour_number, end_at, end_km", "end_at", "end_km", avant),
      proche("vehicle_interventions", "type, created_at, odometer_km", "created_at", "odometer_km", avant),
      proche("fuel_entries", "occurred_at, vehicle_km", "occurred_at", "vehicle_km", avant, TRUSTED_STATUSES),
    ]);
    const releves: DernierReleveKm[] = [];
    if (depart) releves.push({ km: Number(depart.start_km), at: String(depart.start_at), source: `Départ tournée n°${depart.tour_number}` });
    if (retour) releves.push({ km: Number(retour.end_km), at: String(retour.end_at), source: `Retour tournée n°${retour.tour_number}` });
    if (intervention) releves.push({ km: Number(intervention.odometer_km), at: String(intervention.created_at), source: `Intervention : ${intervention.type}` });
    if (plein) releves.push({ km: Number(plein.vehicle_km), at: String(plein.occurred_at), source: "Plein de carburant" });
    return releves;
  };

  const [{ data: vehicle }, avant, apres] = await Promise.all([
    supabase.from("vehicles").select("initial_km, created_at").eq("id", vehicleId).single(),
    sens(true),
    sens(false),
  ]);
  if (vehicle?.initial_km != null && vehicle.created_at) {
    const initial = { km: Number(vehicle.initial_km), at: vehicle.created_at as string, source: "Kilométrage initial" };
    (Date.parse(initial.at) <= Date.parse(iso) ? avant : apres).push(initial);
  }
  return { avant: dernierReleve(avant), apres: premierReleve(apres) };
}
