import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif, aujourdhuiParis } from "@/lib/colis/serveur";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";

const roles = ["direction", "manager"];
const schema = z.object({
  service_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  tour_number: z.string().trim().min(1).max(60),
  date: z.string().date(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
});

/**
 * Affecter une tournée signifie créer une entrée de planning, pas une fiche
 * Tournée colis. La fiche quotidienne est créée par le chauffeur et regroupe
 * ensuite toutes ses affectations de la journée.
 */
export async function GET() {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const user = g.appUser;
  if (!roles.includes(user.role)) return NextResponse.json({ error: "Accès réservé à l'encadrement." }, { status: 403 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const [{ data: services, error: servicesError }, { data: drivers, error: driversError }, { data: vehicles, error: vehiclesError }, { data: routes, error: routesError }] = await Promise.all([
    supabase.from("services").select("id,name").eq("organization_id", user.organization_id).order("name"),
    supabase.from("users").select("id,full_name").eq("organization_id", user.organization_id).eq("active", true).or(FILTRE_CONDUCTEURS).order("full_name"),
    supabase.from("vehicles").select("id,registration,service_id").eq("organization_id", user.organization_id).order("registration"),
    supabase.from("tour_routes").select("id,tour_number,service_id").eq("organization_id", user.organization_id).order("tour_number"),
  ]);
  const error = servicesError ?? driversError ?? vehiclesError ?? routesError;
  if (error) return NextResponse.json({ error: "Impossible de charger les services, chauffeurs, véhicules ou tournées existantes." }, { status: 500 });
  const tours = (routes ?? []).map((r: any) => ({ id: r.id, tour_number: r.tour_number, service_id: r.service_id }));
  return NextResponse.json({ services: services ?? [], drivers: drivers ?? [], vehicles: vehicles ?? [], tours, today: aujourdhuiParis() });
}

export async function POST(req: Request) {
  const g2 = await garderApi({ modules: ["route_optimizer"] });
  if (!g2.ok) return g2.reponse;
  const user = g2.appUser;
  if (!roles.includes(user.role)) return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d'équipe peut affecter une tournée." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });

  const { service_id, driver_id, vehicle_id, tour_number, date, time } = parsed.data;
  const [{ data: driver }, { data: vehicle }, { data: service }, { data: route }] = await Promise.all([
    supabase.from("users").select("id").eq("id", driver_id).eq("organization_id", user.organization_id).eq("active", true).or(FILTRE_CONDUCTEURS).maybeSingle(),
    supabase.from("vehicles").select("id,service_id").eq("id", vehicle_id).eq("organization_id", user.organization_id).maybeSingle(),
    supabase.from("services").select("id").eq("id", service_id).eq("organization_id", user.organization_id).maybeSingle(),
    supabase.from("tour_routes").select("id").eq("organization_id", user.organization_id).eq("service_id", service_id).eq("tour_number", tour_number).maybeSingle(),
  ]);

  if (!driver || !vehicle || !service || !route || (vehicle.service_id && vehicle.service_id !== service_id)) {
    return NextResponse.json({ error: "Choisissez une tournée modèle existante et un chauffeur, service et véhicule valides pour cette organisation." }, { status: 400 });
  }

  const start_at = parisWallTimeToUtcISOString(date, time);
  const { data: assignment, error } = await supabase.from("planning_entries").insert({
    organization_id: user.organization_id,
    service_id,
    driver_id,
    vehicle_id,
    tour_number,
    start_at,
    status: "planned",
  }).select("id,organization_id,service_id,driver_id,vehicle_id,tour_number,start_at,status").single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Cette tournée est déjà affectée à ce créneau pour ce service." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const warning = await warnIfDriverDoubleBooked(supabase, {
    organizationId: user.organization_id,
    driverId: driver_id,
    startAt: start_at,
    excludeEntryId: assignment.id,
  });

  return NextResponse.json({ assignment, warning }, { status: 201 });
}
