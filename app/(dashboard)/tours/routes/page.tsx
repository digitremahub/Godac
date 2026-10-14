import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui";
import { TourRoutesBoard, type TourRoute, type VillageRef } from "@/components/tours/TourRoutesBoard";
import { addDays, parisCalendarDate } from "@/lib/planning/dates";
import { peutGererTournees, peutVoirCarteTournees, tourneesVisibles } from "@/lib/tours/acces-tournees";
import { coverageForEntries, renfortByVillage, type RenfortEntry } from "@/lib/tours/renfort";
import { TourneesTabs } from "@/components/colis/TourneesTabs";

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

const ROUTE_FIELDS = "id, tour_number, service_id, notes, services(name)";
const GEO_VILLAGES = "tour_route_villages(id, name, postal_code, notes, position, lat, lng, insee_code, geocode_status)";
const PLAIN_VILLAGES = "tour_route_villages(id, name, postal_code, notes, position)";

/**
 * Les tournées et leurs villages, avec les coordonnées mises en cache pour
 * la carte et le drapeau « renfort ». Tant qu'une migration n'est pas
 * passée, on relit sans les colonnes manquantes : la page reste
 * utilisable, la carte ou les renforts l'indiquent.
 */
async function loadRoutes(supabase: Supabase) {
  const full = await supabase.from("tour_routes").select(`${ROUTE_FIELDS}, is_renfort, ${GEO_VILLAGES}`).order("tour_number");
  if (!full.error) return { data: full.data as unknown[] | null, geoReady: true, renfortReady: true };
  const withGeo = await supabase.from("tour_routes").select(`${ROUTE_FIELDS}, ${GEO_VILLAGES}`).order("tour_number");
  if (!withGeo.error) return { data: withGeo.data as unknown[] | null, geoReady: true, renfortReady: false };
  const plain = await supabase.from("tour_routes").select(`${ROUTE_FIELDS}, ${PLAIN_VILLAGES}`).order("tour_number");
  return { data: plain.data as unknown[] | null, geoReady: false, renfortReady: false };
}

/**
 * Passages planifiés des tournées de renfort le jour affiché, et leur
 * couverture du jour. Les chauffeurs ne lisent que leurs propres lignes de
 * planning : pour leur montrer « en renfort par la tournée X » sur leur
 * tournée, la lecture se fait côté serveur, limitée à l'organisation, aux
 * tournées de renfort et à ce jour, sans le nom des chauffeurs.
 */
async function loadRenfortDay(
  supabase: Supabase,
  opts: { organizationId: string; gestion: boolean; jour: string; renforts: { id: string; tourNumber: string; serviceId: string | null }[] },
) {
  if (!opts.renforts.length) return { entries: [] as (RenfortEntry & { driverName: string | null; startAt: string })[], dayLinks: [] as { planningEntryId: string; villageId: string }[] };
  let reader: Supabase = supabase;
  if (!opts.gestion) {
    try {
      reader = createAdminSupabaseClient() as unknown as Supabase;
    } catch {
      reader = supabase;
    }
  }
  const byNumber = new Map(opts.renforts.map((r) => [r.tourNumber, r] as const));
  const { data: rows } = await reader
    .from("planning_entries")
    .select(opts.gestion ? "id, tour_number, service_id, start_at, users!planning_entries_driver_id_fkey(full_name)" : "id, tour_number, service_id, start_at")
    .eq("organization_id", opts.organizationId)
    .in("tour_number", Array.from(byNumber.keys()))
    .gte("start_at", `${addDays(opts.jour, -1)}T12:00:00Z`)
    .lt("start_at", `${addDays(opts.jour, 1)}T12:00:00Z`)
    .order("start_at");
  const entries = ((rows ?? []) as any[])
    .filter((e) => parisCalendarDate(e.start_at) === opts.jour)
    .map((e) => ({ e, route: byNumber.get(e.tour_number)! }))
    .filter(({ e, route }) => !route.serviceId || route.serviceId === e.service_id)
    .map(({ e, route }) => ({
      planningEntryId: e.id as string,
      renfortRouteId: route.id,
      tourNumber: route.tourNumber,
      startAt: e.start_at as string,
      driverName: opts.gestion ? ((e.users?.full_name as string | undefined) ?? null) : null,
    }));
  if (!entries.length) return { entries, dayLinks: [] };
  const { data: links } = await reader
    .from("planning_entry_renfort_villages")
    .select("planning_entry_id, village_id")
    .eq("organization_id", opts.organizationId)
    .in(
      "planning_entry_id",
      entries.map((e) => e.planningEntryId),
    );
  return { entries, dayLinks: ((links ?? []) as any[]).map((l) => ({ planningEntryId: l.planning_entry_id as string, villageId: l.village_id as string })) };
}

/**
 * Une fiche par numéro de tournée avec ses villages ordonnés et ses
 * consignes. Direction et chefs d'équipe : toutes les tournées, la carte,
 * les incohérences et la modification. Les autres rôles (chauffeurs) :
 * une liste en lecture seule des tournées de leurs services et de celles
 * où ils sont planifiés — ni carte ni coordonnées.
 */
export default async function TourRoutesPage({ searchParams }: { searchParams: Promise<{ jour?: string }> }) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const gestion = peutGererTournees(appUser.role);
  const carte = peutVoirCarteTournees(appUser.role);

  const today = parisCalendarDate(new Date().toISOString());
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(params.jour ?? "") ? params.jour! : today;

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [{ data: routes, geoReady, renfortReady }, { data: services }, { data: myServices }, { data: recentTours }, { data: myPlanned }] = await Promise.all([
    loadRoutes(supabase),
    supabase.from("services").select("id, name").order("name"),
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id),
    gestion
      ? supabase.from("planning_entries").select("tour_number").gte("start_at", since).not("tour_number", "like", "________-%")
      : Promise.resolve({ data: [] as { tour_number: string }[] }),
    // Les tournées où l'on est planifié (hier → dans une semaine), visibles même hors de ses services.
    gestion
      ? Promise.resolve({ data: [] as { tour_number: string }[] })
      : supabase
          .from("planning_entries")
          .select("tour_number")
          .eq("driver_id", appUser.id)
          .gte("start_at", `${addDays(today, -1)}T00:00:00Z`)
          .lt("start_at", `${addDays(today, 8)}T00:00:00Z`),
  ]);

  const all: TourRoute[] = ((routes ?? []) as any[]).map((r) => ({
    id: r.id,
    tourNumber: r.tour_number,
    serviceId: r.service_id,
    serviceName: r.services?.name ?? null,
    notes: r.notes,
    isRenfort: Boolean(r.is_renfort),
    renfortVillageIds: [],
    passages: [],
    villages: ((r.tour_route_villages ?? []) as any[])
      .sort((a, b) => a.position - b.position)
      .map((v) => ({
        id: v.id,
        name: v.name,
        postal_code: v.postal_code,
        notes: v.notes,
        // Coordonnées : seulement pour ceux qui voient la carte.
        ...(carte ? { lat: v.lat ?? null, lng: v.lng ?? null, insee_code: v.insee_code ?? null, geocode_status: v.geocode_status ?? null } : {}),
      })),
  }));

  // Renforts : couverture par défaut, passages du jour et couverture du jour.
  const renforts = all.filter((r) => r.isRenfort);
  if (renfortReady && renforts.length) {
    const [{ data: defaults }, day] = await Promise.all([
      supabase.from("tour_route_renfort_villages").select("renfort_route_id, village_id"),
      loadRenfortDay(supabase, { organizationId: appUser.organization_id, gestion, jour, renforts }),
    ]);
    const defaultLinks = ((defaults ?? []) as any[]).map((l) => ({ renfortRouteId: l.renfort_route_id as string, villageId: l.village_id as string }));
    for (const r of renforts) r.renfortVillageIds = defaultLinks.filter((l) => l.renfortRouteId === r.id).map((l) => l.villageId);
    const coverage = coverageForEntries(day.entries, defaultLinks, day.dayLinks);
    for (const e of day.entries) {
      const route = renforts.find((r) => r.id === e.renfortRouteId);
      const c = coverage.get(e.planningEntryId);
      if (route && c) route.passages.push({ planningEntryId: e.planningEntryId, startAt: e.startAt, driverName: e.driverName, villageIds: c.villageIds, specific: c.specific });
    }
    const par = renfortByVillage(day.entries, coverage);
    for (const r of all) for (const v of r.villages) if (v.id && par.has(v.id)) v.renfortPar = par.get(v.id);
  }

  const myServiceIds = (myServices ?? []).map((s) => s.service_id as string);
  const visible = tourneesVisibles(all, {
    role: appUser.role,
    myServiceIds,
    plannedTourNumbers: (myPlanned ?? []).map((p) => p.tour_number as string),
  });

  // Les villages empruntés par les renforts affichés, décrits avec leur tournée d'origine.
  const needed = new Set(gestion ? all.flatMap((r) => r.villages.map((v) => v.id!)) : visible.flatMap((r) => [...r.renfortVillageIds, ...r.passages.flatMap((p) => p.villageIds)]));
  const villageRefs: Record<string, VillageRef> = {};
  for (const r of all)
    for (const v of r.villages)
      if (v.id && needed.has(v.id)) villageRefs[v.id] = { name: v.name, postal_code: v.postal_code, notes: v.notes, routeId: r.id, tourNumber: r.tourNumber, serviceId: r.serviceId };

  const known = new Set(all.map((r) => r.tourNumber));
  const missingTourNumbers = Array.from(new Set((recentTours ?? []).map((t) => t.tour_number).filter(Boolean)))
    .filter((n) => !known.has(n))
    .sort()
    .slice(0, 20);

  return (
    <div>
      <PageHeader
        title="Tournées colis"
        description={
          gestion
            ? "Renseignez les villages de chaque tournée, dans l'ordre de passage, avec les infos utiles. Les chauffeurs du service les retrouvent ici (en liste) et sur leur tableau de bord."
            : "Les villages des tournées de votre service, dans l'ordre de passage, avec les infos utiles."
        }
      />
      <TourneesTabs canTrack={["manager", "manager_chauffeur", "direction"].includes(appUser.role)} />
      <TourRoutesBoard
        routes={visible}
        canEdit={gestion}
        canSeeMap={carte}
        services={services ?? []}
        missingTourNumbers={missingTourNumbers}
        geoReady={geoReady}
        renfortReady={renfortReady}
        villageRefs={villageRefs}
        jour={jour}
        today={today}
      />
    </div>
  );
}
