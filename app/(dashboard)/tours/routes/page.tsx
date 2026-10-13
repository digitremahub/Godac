import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TourRoutesBoard, type TourRoute } from "@/components/tours/TourRoutesBoard";

const ROUTE_FIELDS = "id, tour_number, service_id, notes, services(name)";

/**
 * Les tournées et leurs villages, avec les coordonnées mises en cache pour
 * la carte. Tant que la migration des coordonnées n'est pas passée, on
 * relit sans elles : la page reste utilisable, la carte l'indique.
 */
async function loadRoutes(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>) {
  const withGeo = await supabase
    .from("tour_routes")
    .select(`${ROUTE_FIELDS}, tour_route_villages(id, name, postal_code, notes, position, lat, lng, insee_code, geocode_status)`)
    .order("tour_number");
  if (!withGeo.error) return { data: withGeo.data as unknown[] | null, geoReady: true };
  const plain = await supabase.from("tour_routes").select(`${ROUTE_FIELDS}, tour_route_villages(id, name, postal_code, notes, position)`).order("tour_number");
  return { data: plain.data as unknown[] | null, geoReady: false };
}

/**
 * One sheet per tour number with its ordered villages and practical
 * notes. Direction and chefs d'équipe edit; drivers read the tours of
 * their own services (plus those not tied to a service).
 */
export default async function TourRoutesPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const canEdit = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ data: routes, geoReady }, { data: services }, { data: myServices }, { data: recentTours }] = await Promise.all([
    loadRoutes(supabase),
    supabase.from("services").select("id, name").order("name"),
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id),
    canEdit
      ? supabase.from("planning_entries").select("tour_number").gte("start_at", since).not("tour_number", "like", "________-%")
      : Promise.resolve({ data: [] as { tour_number: string }[] }),
  ]);

  const myServiceIds = new Set((myServices ?? []).map((s) => s.service_id));
  const all: TourRoute[] = ((routes ?? []) as any[]).map((r) => ({
    id: r.id,
    tourNumber: r.tour_number,
    serviceId: r.service_id,
    serviceName: r.services?.name ?? null,
    notes: r.notes,
    villages: ((r.tour_route_villages ?? []) as any[])
      .sort((a, b) => a.position - b.position)
      .map((v) => ({
        id: v.id,
        name: v.name,
        postal_code: v.postal_code,
        notes: v.notes,
        lat: v.lat ?? null,
        lng: v.lng ?? null,
        insee_code: v.insee_code ?? null,
        geocode_status: v.geocode_status ?? null,
      })),
  }));
  const visible = canEdit || appUser.role === "comptable" ? all : all.filter((r) => !r.serviceId || myServiceIds.has(r.serviceId));

  const known = new Set(all.map((r) => r.tourNumber));
  const missingTourNumbers = Array.from(new Set((recentTours ?? []).map((t) => t.tour_number).filter(Boolean)))
    .filter((n) => !known.has(n))
    .sort()
    .slice(0, 20);

  return (
    <div>
      <PageHeader
        title="Tournées & villages"
        description={
          canEdit
            ? "Renseignez les villages de chaque tournée, dans l'ordre de passage, avec les infos utiles. Les chauffeurs du service les retrouvent ici et sur leur tableau de bord."
            : "Les villages de vos tournées, dans l'ordre de passage, avec les infos utiles."
        }
      />
      <TourRoutesBoard routes={visible} canEdit={canEdit} services={services ?? []} missingTourNumbers={missingTourNumbers} geoReady={geoReady} />
    </div>
  );
}
