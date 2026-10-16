import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const writeRoles = ["direction", "manager", "manager_chauffeur"] as const;

const createSchema = z.object({
  service_id: z.string().uuid(),
  route_id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  departure_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("07:00"),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1, 2, 3, 4, 5]),
  default_vehicle_id: z.string().uuid().nullable().optional(),
});

/** Liste les modèles de tournées du service (ou de tous les services pour la Direction). */
export async function GET(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { searchParams } = new URL(req.url);
  const requestedService = searchParams.get("service_id");

  const { data: serviceLinks, error: linksError } = await supabase
    .from("user_services")
    .select("service_id")
    .eq("user_id", appUser.id);
  if (linksError) return NextResponse.json({ error: "Impossible de lire les services autorisés." }, { status: 500 });

  const serviceIds = (serviceLinks ?? []).map((x) => x.service_id);
  let query = supabase
    .from("planning_tour_templates")
    .select("id, service_id, route_id, name, departure_time, weekdays, default_vehicle_id, active, services(name), tour_routes(tour_number, notes, tour_route_villages(id, name, postal_code, position, notes))")
    .eq("organization_id", appUser.organization_id)
    .eq("active", true)
    .order("name");

  if (requestedService) {
    if (appUser.role !== "direction" && !serviceIds.includes(requestedService)) {
      return NextResponse.json({ error: "Ce service ne fait pas partie de vos services autorisés." }, { status: 403 });
    }
    query = query.eq("service_id", requestedService);
  } else if (appUser.role !== "direction") {
    if (!serviceIds.length) return NextResponse.json({ templates: [] });
    query = query.in("service_id", serviceIds);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Impossible de charger les modèles de tournées. Vérifiez que la migration planning_tour_templates est appliquée." }, { status: 503 });
  return NextResponse.json({ templates: data ?? [] });
}

/** Crée un modèle à partir d'une fiche tournée existante et de ses villages. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (!writeRoles.includes(appUser.role as (typeof writeRoles)[number])) {
    return NextResponse.json({ error: "Seule la Direction ou un responsable autorisé peut créer un modèle." }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;
  const supabase = await createServerSupabaseClient();

  const [{ data: service }, { data: route }, { data: vehicle }] = await Promise.all([
    supabase.from("services").select("id").eq("id", input.service_id).eq("organization_id", appUser.organization_id).maybeSingle(),
    supabase.from("tour_routes").select("id, service_id, tour_number").eq("id", input.route_id).eq("organization_id", appUser.organization_id).maybeSingle(),
    input.default_vehicle_id
      ? supabase.from("vehicles").select("id, service_id").eq("id", input.default_vehicle_id).eq("organization_id", appUser.organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!service) return NextResponse.json({ error: "Service introuvable dans votre organisation." }, { status: 404 });
  if (!route || route.service_id !== input.service_id) {
    return NextResponse.json({ error: "La fiche tournée doit appartenir au service sélectionné." }, { status: 400 });
  }
  if (input.default_vehicle_id && (!vehicle || (vehicle.service_id && vehicle.service_id !== input.service_id))) {
    return NextResponse.json({ error: "Le véhicule sélectionné n'est pas compatible avec ce service." }, { status: 400 });
  }

  const { data, error } = await supabase.from("planning_tour_templates").insert({
    organization_id: appUser.organization_id,
    service_id: input.service_id,
    route_id: input.route_id,
    name: input.name,
    departure_time: input.departure_time,
    weekdays: [...new Set(input.weekdays)].sort((a, b) => a - b),
    default_vehicle_id: input.default_vehicle_id ?? null,
    created_by: appUser.id,
  }).select("id, service_id, route_id, name, departure_time, weekdays, default_vehicle_id, active").single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Un modèle porte déjà ce nom dans ce service." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ template: data }, { status: 201 });
}
