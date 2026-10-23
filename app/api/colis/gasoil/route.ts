import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { COEF_ROUTE, distanceKm, evaluerPlein, litresEstimes, meilleureStation, type StationOSM } from "@/lib/colis/gasoil";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";
import { getVehicleLastKnownKm } from "@/lib/vehicles/odometer-reference";

const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const UA = "GODAC/1.0 (https://godac.app; contact@godac.fr)";
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const querySchema = z.object({ run_id: z.string().uuid(), lat, lng, vers_lat: lat, vers_lng: lng });

/**
 * Passage au gasoil avant le retour : station diesel la moins détournée
 * autour du chauffeur (OpenStreetMap) et consommation estimée du retour
 * d'après la consommation du véhicule sur 60 jours (L/100 km), et niveau
 * estimé du réservoir (km depuis le dernier plein × L/100 km, capacité du
 * véhicule) pour dire si le plein est nécessaire. Indicatif : le niveau n'est
 * pas mesuré, le chauffeur décide.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, g.appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const q = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const run = await tourneeParId(supabase, g.appUser, q.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  const depuis = { lat: q.data.lat, lng: q.data.lng };
  const vers = { lat: q.data.vers_lat, lng: q.data.vers_lng };

  const { data: v } = await supabase.from("delivery_runs").select("vehicle_id").eq("id", run.id).maybeSingle();
  const vehicleId = (v as { vehicle_id: string | null } | null)?.vehicle_id ?? null;
  const [lPer100, capaciteL, dernierPlein, kmActuel, stations] = await Promise.all([
    vehicleId ? getVehicleConsumption(supabase, vehicleId, 60).catch(() => null) : Promise.resolve(null),
    vehicleId
      ? supabase.from("vehicles").select("tank_capacity_liters").eq("id", vehicleId).maybeSingle().then((r) => (r.data?.tank_capacity_liters != null ? Number(r.data.tank_capacity_liters) : null))
      : Promise.resolve(null),
    vehicleId
      ? supabase
          .from("fuel_entries")
          .select("vehicle_km")
          .eq("vehicle_id", vehicleId)
          .in("status", ["manual", "validated"])
          .eq("product", "gazole")
          .not("vehicle_km", "is", null)
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r) => (r.data?.vehicle_km != null ? Number(r.data.vehicle_km) : null))
      : Promise.resolve(null),
    vehicleId ? getVehicleLastKnownKm(supabase, vehicleId).catch(() => null) : Promise.resolve(null),
    fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: new URLSearchParams({ data: `[out:json][timeout:10];nwr(around:8000,${depuis.lat},${depuis.lng})["amenity"="fuel"];out center tags;` }),
      cache: "no-store",
      signal: AbortSignal.timeout(11000),
    })
      .then(async (r) => (r.ok ? (((await r.json()) as { elements?: StationOSM[] }).elements ?? []) : []))
      .catch(() => [] as StationOSM[]),
  ]);

  const retourKm = Math.round(distanceKm(depuis, vers) * COEF_ROUTE * 10) / 10;
  return NextResponse.json({
    station: meilleureStation(depuis, vers, stations),
    retour: { km: retourKm, lPer100, litres: litresEstimes(retourKm, lPer100) },
    plein: evaluerPlein({ capaciteL, kmDepuisPlein: dernierPlein !== null && kmActuel !== null ? kmActuel - dernierPlein : null, lPer100, retourKm }),
    capaciteL,
  });
}
