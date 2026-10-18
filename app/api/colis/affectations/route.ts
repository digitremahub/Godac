import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cleAdresse, moduleActif, aujourdhuiParis } from "@/lib/colis/serveur";
import { codePays } from "@/lib/pays/serveur";
import { geocodeAddress } from "@/lib/geo/geocode";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";
import { synchroniserTourneeColis } from "@/lib/colis/synchronisation";

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
  const start_at = parisWallTimeToUtcISOString(date, time);

  const [{ data: driver }, { data: vehicle }, { data: service }, { data: routes }] = await Promise.all([
    supabase.from("users").select("id,organization_id").eq("id", driver_id).eq("organization_id", user.organization_id).eq("active", true).maybeSingle(),
    supabase.from("vehicles").select("id,service_id,organization_id").eq("id", vehicle_id).eq("organization_id", user.organization_id).maybeSingle(),
    supabase.from("services").select("id,organization_id").eq("id", service_id).eq("organization_id", user.organization_id).maybeSingle(),
    supabase.from("tour_routes").select("id,tour_number,service_id").eq("organization_id", user.organization_id).eq("tour_number", tour_number),
  ]);
  const route = (routes ?? []).find((r: any) => !r.service_id || r.service_id === service_id);
  if (!driver || !vehicle || !service || !route || vehicle.service_id !== service_id) {
    return NextResponse.json({ error: "Choisissez une tournée existante et un chauffeur, service et véhicule valides pour cette organisation." }, { status: 400 });
  }

  // L'affectation exceptionnelle crée une entrée datée dans le Planning.
  // La synchronisation officielle réutilise la tournée colis déjà liée, ou
  // en crée une seule si nécessaire : aucune insertion delivery_runs parallèle.
  const { data: entry, error: entryError } = await supabase.from("planning_entries").insert({
    organization_id: user.organization_id, service_id, driver_id, vehicle_id, tour_number, start_at, status: "planned",
  }).select("id,organization_id,service_id,driver_id,vehicle_id,tour_number,start_at").single();
  if (entryError) return NextResponse.json({ error: entryError.code === "23505" ? "Une affectation existe déjà à cette date et heure." : entryError.message }, { status: entryError.code === "23505" ? 409 : 500 });

  let runId: string | null = null;
  try {
    runId = await synchroniserTourneeColis(supabase, entry);
    if (!runId) throw new Error("La tournée colis n'a pas pu être reliée à l'affectation.");
    const { data: run, error: runError } = await supabase.from("delivery_runs")
      .select("id,name,run_date,driver_id,service_id,vehicle_id,planning_entry_id")
      .eq("organization_id", user.organization_id).eq("id", runId).single();
    if (runError || !run) throw new Error(runError?.message ?? "Tournée colis introuvable après synchronisation.");

    // Précharger les ramasses des villages de la tournée existante, sans
    // modifier la fiche modèle ni créer une seconde tournée.
    let pickupWarning: string | null = null;
    try {
      const { data: villages, error: villagesError } = await supabase.from("tour_route_villages")
        .select("name,pickup_addresses,position").eq("route_id", route.id).order("position");
      if (villagesError) throw villagesError;
      const { count: existingStops, error: stopsError } = await supabase.from("delivery_stops")
        .select("id", { count: "exact", head: true }).eq("run_id", run.id);
      if (stopsError) throw stopsError;
      if ((existingStops ?? 0) === 0) {
        const pays = await codePays(user.organization_id);
        const seen = new Set<string>();
        let listPosition = 0;
        let stopPosition = 0;
        for (const village of villages ?? []) {
          const addresses = (Array.isArray(village.pickup_addresses) ? village.pickup_addresses : [])
            .filter((a): a is string => typeof a === "string")
            .map((a) => a.trim()).filter((a) => {
              const key = cleAdresse(a);
              if (a.length < 5 || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          if (!addresses.length) continue;
          const { data: list, error: listError } = await supabase.from("delivery_lists").insert({
            organization_id: user.organization_id, run_id: run.id, name: village.name.slice(0, 60), position: listPosition++,
          }).select("id").single();
          if (listError) throw listError;
          for (const address of addresses) {
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
      console.error("[colis/affectations] Ramasses incomplètes", { runId: run.id, error });
      pickupWarning = "Affectation enregistrée, mais certaines ramasses n'ont pas pu être préchargées. Vérifiez la fiche de tournée.";
    }
    const warning = await warnIfDriverDoubleBooked(supabase, { organizationId: user.organization_id, driverId: driver_id, startAt: start_at, excludeEntryId: entry.id });
    return NextResponse.json({ planning_entry_id: entry.id, run, warning, pickupWarning }, { status: 201 });
  } catch (error) {
    // Évite de laisser une affectation orpheline si la synchronisation échoue.
    if (runId) await supabase.from("delivery_runs").delete().eq("organization_id", user.organization_id).eq("id", runId).eq("planning_entry_id", entry.id);
    await supabase.from("planning_entries").delete().eq("id", entry.id).eq("status", "planned");
    return NextResponse.json({ error: error instanceof Error ? error.message : "Affectation impossible." }, { status: 500 });
  }
}
