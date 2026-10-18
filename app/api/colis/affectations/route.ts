import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cleAdresse, moduleActif, aujourdhuiParis } from "@/lib/colis/serveur";
import { codePays } from "@/lib/pays/serveur";
import { geocodeAddress } from "@/lib/geo/geocode";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";

const roles = ["direction", "manager", "manager_chauffeur"];
const schema = z.object({
  service_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  tour_number: z.string().trim().min(1).max(60),
  date: z.string().date(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});

export async function GET() {
  const user = await requireAppUser();
  if (!roles.includes(user.role)) return NextResponse.json({ error: "Accès réservé à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const [{ data: services, error: servicesError }, { data: drivers, error: driversError }, { data: vehicles, error: vehiclesError }, { data: routes, error: routesError }] = await Promise.all([
    supabase.from("services").select("id,name").eq("organization_id", user.organization_id).order("name"),
    supabase.from("users").select("id,full_name").eq("organization_id", user.organization_id).eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
    supabase.from("vehicles").select("id,registration,service_id").eq("organization_id", user.organization_id).order("registration"),
    supabase.from("tour_routes").select("id,tour_number,service_id").eq("organization_id", user.organization_id).order("tour_number"),
  ]);
  const error = servicesError ?? driversError ?? vehiclesError ?? routesError;
  if (error) return NextResponse.json({ error: "Impossible de charger les services, chauffeurs, véhicules ou tournées existantes." }, { status: 500 });
  const tours = (routes ?? []).map((r: any) => ({ id: r.id, tour_number: r.tour_number, service_id: r.service_id }));
  return NextResponse.json({ services: services ?? [], drivers: drivers ?? [], vehicles: vehicles ?? [], tours, today: aujourdhuiParis() });
}

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!roles.includes(user.role)) return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d'équipe peut affecter une tournée." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { service_id, driver_id, vehicle_id, tour_number, date, time } = parsed.data;
  const plannedStart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(parisWallTimeToUtcISOString(date, time)));

  const [{ data: driver }, { data: vehicle }, { data: service }, { data: routes }] = await Promise.all([
    supabase.from("users").select("id").eq("id", driver_id).eq("organization_id", user.organization_id).eq("active", true).maybeSingle(),
    supabase.from("vehicles").select("id,service_id").eq("id", vehicle_id).eq("organization_id", user.organization_id).maybeSingle(),
    supabase.from("services").select("id,name,depot_address,depot_lat,depot_lng").eq("id", service_id).eq("organization_id", user.organization_id).maybeSingle(),
    supabase.from("tour_routes").select("id,tour_number,service_id").eq("organization_id", user.organization_id).eq("tour_number", tour_number),
  ]);
  const route = (routes ?? []).find((r: any) => r.service_id === service_id);
  if (!driver || !vehicle || !service || !route || vehicle.service_id !== service_id) {
    return NextResponse.json({ error: "Choisissez une tournée existante et un chauffeur, service et véhicule valides pour cette organisation." }, { status: 400 });
  }

  // Évite de créer deux instances identiques si l'utilisateur double-clique
  // ou relance la demande après un délai réseau.
  const runName = `Tournée n°${tour_number}`;
  const { data: existingRun, error: existingRunError } = await supabase.from("delivery_runs")
    .select("id,status")
    .eq("organization_id", user.organization_id)
    .eq("driver_id", driver_id)
    .eq("run_date", date)
    .eq("name", runName)
    .maybeSingle();
  if (existingRunError) return NextResponse.json({ error: existingRunError.message }, { status: 500 });
  if (existingRun) return NextResponse.json({ error: existingRun.status === "done" ? "Cette tournée est déjà clôturée pour ce chauffeur à cette date." : "Cette tournée est déjà affectée à ce chauffeur à cette date." }, { status: 409 });

  // Affectation ponctuelle distincte du Planning : on crée une instance datée
  // de la tournée modèle, sans créer/modifier de planning_entry ni le modèle.
  const { data: run, error: runError } = await supabase.from("delivery_runs").insert({
    organization_id: user.organization_id,
    driver_id,
    vehicle_id,
    service_id,
    run_date: date,
    name: runName,
    planned_start: plannedStart,
    start_label: service.depot_address ?? (service.name ? `Dépôt ${service.name}` : null),
    start_lat: service.depot_lat ?? null,
    start_lng: service.depot_lng ?? null,
  }).select("id,name,run_date,driver_id,service_id,vehicle_id,planned_start").single();
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 });

  let pickupWarning: string | null = null;
  try {
    const { data: villages, error: villagesError } = await supabase.from("tour_route_villages")
      .select("name,pickup_addresses,planned_stops,position").eq("route_id", route.id).order("position");
    if (villagesError) throw villagesError;
    const pays = await codePays(user.organization_id);
    const seen = new Set<string>();
    let listPosition = 0;
    let stopPosition = 0;
    for (const village of villages ?? []) {
      const planned = Array.isArray(village.planned_stops) ? village.planned_stops : [];
      const stops: { address: string; kind: "ramasse" | "point_relais" }[] = planned
        .filter((s: any) => s && typeof s.address === "string")
        .map((s: any) => ({
          address: s.address.trim(),
          kind: s.type === "point_relais" ? "point_relais" as const : "ramasse" as const,
        }));
      // Compatibilité avec les anciens modèles qui stockaient uniquement
      // les adresses de ramasse dans pickup_addresses.
      for (const address of (Array.isArray(village.pickup_addresses) ? village.pickup_addresses : [])) {
        if (typeof address === "string") stops.push({ address: address.trim(), kind: "ramasse" });
      }
      const uniqueStops = stops.filter((stop) => {
        if (stop.address.length < 5) return false;
        const key = `${stop.kind}:${cleAdresse(stop.address)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (!uniqueStops.length) continue;
      const { data: list, error: listError } = await supabase.from("delivery_lists").insert({
        organization_id: user.organization_id, run_id: run.id, name: village.name.slice(0, 60), position: listPosition++,
      }).select("id").single();
      if (listError) throw listError;
      for (const stop of uniqueStops) {
        const geo = await geocodeAddress(stop.address, pays).catch(() => null);
        const { error: stopError } = await supabase.from("delivery_stops").insert({
          organization_id: user.organization_id, run_id: run.id, list_id: list.id, position: stopPosition++,
          kind: stop.kind, address: stop.address, parcel_count: 1, status: "pending", lat: geo?.lat ?? null, lng: geo?.lng ?? null,
        });
        if (stopError) throw stopError;
      }
    }
  } catch (error) {
    console.error("[colis/affectations] Ramasses incomplètes", { runId: run.id, error });
    pickupWarning = "Tournée affectée, mais certaines ramasses n'ont pas pu être préchargées. Vérifiez la fiche de tournée.";
  }
  return NextResponse.json({ run, pickupWarning }, { status: 201 });
}
