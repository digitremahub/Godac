import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cleAdresse, moduleActif, aujourdhuiParis } from "@/lib/colis/serveur";
import { codePays } from "@/lib/pays/serveur";
import { geocodeAddress } from "@/lib/geo/geocode";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";

const roles = ["direction", "manager", "manager_chauffeur"];
const schema = z.object({
  service_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  tour_number: z.string().trim().min(1).max(60),
  date: z.string().date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function GET() {
  const user = await requireAppUser();
  if (!roles.includes(user.role)) return NextResponse.json({ error: "Accès réservé à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const [{ data: services }, { data: drivers }, { data: vehicles }] = await Promise.all([
    supabase.from("services").select("id,name").eq("organization_id", user.organization_id).order("name"),
    supabase.from("users").select("id,full_name").eq("organization_id", user.organization_id).eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
    supabase.from("vehicles").select("id,registration,service_id").eq("organization_id", user.organization_id).order("registration"),
  ]);
  return NextResponse.json({ services: services ?? [], drivers: drivers ?? [], vehicles: vehicles ?? [], today: aujourdhuiParis() });
}

export async function POST(req: Request) {
  const user = await requireAppUser();
  if (!roles.includes(user.role)) return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d'équipe peut affecter une tournée." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { service_id, driver_id, vehicle_id, tour_number, date, time } = parsed.data;
  const start_at = parisWallTimeToUtcISOString(date, time);
  const [{ data: driver }, { data: vehicle }] = await Promise.all([
    supabase.from("users").select("id,full_name,organization_id").eq("id", driver_id).eq("organization_id", user.organization_id).eq("active", true).maybeSingle(),
    supabase.from("vehicles").select("id,service_id,organization_id").eq("id", vehicle_id).eq("organization_id", user.organization_id).maybeSingle(),
  ]);
  const { data: serviceCheck } = await supabase.from("services").select("id,organization_id").eq("id", service_id).eq("organization_id", user.organization_id).maybeSingle();
  if (!driver || !vehicle || !serviceCheck || vehicle.service_id !== service_id) return NextResponse.json({ error: "Chauffeur, service ou véhicule invalide pour cette organisation." }, { status: 400 });
  const { data: entry, error: entryError } = await supabase.from("planning_entries").insert({
    organization_id: user.organization_id, service_id, driver_id, vehicle_id, tour_number, start_at, status: "planned",
  }).select("id").single();
  if (entryError) return NextResponse.json({ error: entryError.code === "23505" ? "Une affectation existe déjà à cette date et heure." : entryError.message }, { status: entryError.code === "23505" ? 409 : 500 });

  const { data: service } = await supabase.from("services").select("name,depot_address,depot_lat,depot_lng").eq("id", service_id).maybeSingle();
  const { data: run, error: runError } = await supabase.from("delivery_runs").insert({
    organization_id: user.organization_id, driver_id, vehicle_id, service_id, run_date: date,
    name: `Tournée n°${tour_number}`, planned_start: time, planning_entry_id: entry.id,
    start_label: service?.depot_address ?? (service?.name ? `Dépôt ${service.name}` : null),
    start_lat: service?.depot_lat ?? null, start_lng: service?.depot_lng ?? null,
  }).select("id,name,run_date,driver_id").single();
  if (runError) {
    await supabase.from("planning_entries").delete().eq("id", entry.id).eq("status", "planned");
    return NextResponse.json({ error: `Affectation non finalisée : ${runError.message}` }, { status: 500 });
  }
  // Charger les ramasses configurées sur la fiche de tournée/villages dès
  // l'affectation, sans attendre que le chauffeur crée manuellement une tournée.
  let pickupWarning: string | null = null;
  try {
    const { data: route, error: routeError } = await supabase.from("tour_routes")
      .select("id").eq("organization_id", user.organization_id).eq("tour_number", tour_number).maybeSingle();
    if (routeError) throw routeError;
    if (route) {
      const { data: villages, error: villagesError } = await supabase.from("tour_route_villages")
        .select("name,pickup_addresses,position").eq("route_id", route.id).order("position");
      if (villagesError) throw villagesError;
      const pays = await codePays(user.organization_id);
      const seen = new Set<string>();
      let listPosition = 0;
      let stopPosition = 0;
      for (const village of villages ?? []) {
        const addresses = (Array.isArray(village.pickup_addresses) ? village.pickup_addresses : [])
          .filter((a): a is string => typeof a === "string")
          .map((a) => a.trim()).filter((a) => { const key = cleAdresse(a); if (a.length < 5 || seen.has(key)) return false; seen.add(key); return true; });
        if (!addresses.length) continue;
        const { data: list, error: listError } = await supabase.from("delivery_lists").insert({
          organization_id: user.organization_id, run_id: run.id, name: village.name.slice(0, 60), position: listPosition++,
        }).select("id").single();
        if (listError) throw listError;
        for (const address of addresses) {
          const key = cleAdresse(address);
          seen.add(key);
          const geo = await geocodeAddress(address, pays).catch(() => null);
          const { error: stopError } = await supabase.from("delivery_stops").insert({
            organization_id: user.organization_id, run_id: run.id, list_id: list.id, position: stopPosition++,
            kind: "ramasse", address, parcel_count: 1, status: "pending", lat: geo?.lat ?? null, lng: geo?.lng ?? null,
          });
          if (stopError) throw stopError;
        }
      }
    }
  } catch (error) {
    console.error("[colis/affectations] Tournée créée, ramasses incomplètes", { runId: run.id, error });
    pickupWarning = "Tournée créée, mais certaines ramasses n'ont pas pu être ajoutées. Vérifiez la fiche de tournée et les migrations Supabase.";
  }
  const warning = await warnIfDriverDoubleBooked(supabase, { organizationId: user.organization_id, driverId: driver_id, startAt: start_at, excludeEntryId: entry.id });
  return NextResponse.json({ planning_entry_id: entry.id, run, warning, pickupWarning }, { status: 201 });
}
