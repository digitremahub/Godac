import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ReportsViewTabs } from "@/components/reports/ReportsViewTabs";
import { ReportFilters } from "@/components/reports/ReportFilters";
import { ReportsTable, type ReportRow } from "@/components/reports/ReportsTable";
import { addDays, todayISO } from "@/lib/planning/dates";

interface PhotoRow {
  id: string;
  tour_number: string;
  start_at: string;
  start_photo_path: string | null;
  end_photo_path: string | null;
  report_bl_number: string | null;
  report_stops_total: number | null;
  report_packages_count: number | null;
  services: { name: string } | null;
  vehicles: { registration: string } | null;
  users: { full_name: string } | null;
}

const REPORT_FIELDS_FILTER = [
  "report_bl_number.not.is.null",
  "report_stops_total.not.is.null",
  "report_packages_count.not.is.null",
  "report_priority_count.not.is.null",
  "report_stops_delivered.not.is.null",
  "report_packages_missing.not.is.null",
  "report_pickups.not.is.null",
  "report_packages_picked_up.not.is.null",
  "report_packages_returned.not.is.null",
  "report_packages_relay.not.is.null",
].join(",");

interface ReportsSearchParams {
  view?: string;
  from?: string;
  to?: string;
  service?: string;
  driver?: string;
}

/**
 * The data behind this page has been captured since Lot C (the
 * départ/retour tour photo → OCR extraction of "Num Tour / Num BL /
 * arrêts / colis…", see lib/ocr/tour-report.ts) but had no page
 * anywhere to show it — report_* columns (and the photos themselves)
 * on planning_entries were written and never read back. Two views:
 * "Tableau" (the extracted fields, structured) and "Photos" (the raw
 * captures, for visually checking a reading the OCR got wrong or
 * couldn't make out at all). Filters + service scoping mirror
 * /tours/history: planning_entries' own RLS ("planning: read within
 * org") already restricts a manager-like user to their own service(s)
 * — the service dropdown just lets them narrow further when they
 * manage more than one.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportsSearchParams> }) {
  const params = await searchParams;
  const view = params.view === "photos" ? "photos" : "table";
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");
  if (!planningEnabled) {
    return (
      <EmptyState
        title="Module Planning non activé"
        description="Les rapports de tournée dépendent du module Planning — activez-le depuis les paramètres de votre organisation."
      />
    );
  }

  const isDirection = appUser.role === "direction";
  const from = params.from && !Number.isNaN(Date.parse(params.from)) ? params.from : addDays(todayISO(), -30);
  const to = params.to && !Number.isNaN(Date.parse(params.to)) ? params.to : todayISO();
  const toExclusive = addDays(to, 1);

  const [{ data: allServices }, { data: myServiceRows }, { data: drivers }] = await Promise.all([
    isDirection ? supabase.from("services").select("id, name").order("name") : Promise.resolve({ data: null }),
    isDirection ? Promise.resolve({ data: null }) : supabase.from("user_services").select("services(id, name)").eq("user_id", appUser.id),
    supabase.from("users").select("id, full_name").eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
  ]);

  const services = isDirection ? (allServices ?? []) : ((myServiceRows ?? []) as any[]).map((r) => r.services).filter(Boolean);

  const filters = { from, to, service: params.service ?? "", driver: params.driver ?? "" };

  return (
    <div>
      <PageHeader
        title="Rapports de tournée"
        description="Données lues automatiquement sur les photos de feuille de tournée (départ/retour) — numéro de BL, horaires, arrêts, colis."
      />
      <ReportsViewTabs view={view} />
      <ReportFilters
        view={view}
        from={from}
        to={to}
        services={services}
        drivers={drivers ?? []}
        selectedService={filters.service}
        selectedDriver={filters.driver}
      />
      {view === "photos" ? (
        <PhotosView supabase={supabase} from={from} toExclusive={toExclusive} service={filters.service} driver={filters.driver} />
      ) : (
        <TableView
          supabase={supabase}
          from={from}
          toExclusive={toExclusive}
          service={filters.service}
          driver={filters.driver}
          canEdit={isDirection}
        />
      )}
    </div>
  );
}

async function TableView({
  supabase,
  from,
  toExclusive,
  service,
  driver,
  canEdit,
}: {
  canEdit: boolean;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  from: string;
  toExclusive: string;
  service: string;
  driver: string;
}) {
  let query = supabase
    .from("planning_entries")
    .select(
      "id, tour_number, start_at, report_bl_number, report_departure_time, report_return_time, report_stops_total, report_packages_count, report_priority_count, report_stops_delivered, report_packages_missing, report_pickups, report_packages_picked_up, report_packages_returned, report_packages_relay, services(name), vehicles(registration), users!planning_entries_driver_id_fkey(full_name)",
    )
    .or(REPORT_FIELDS_FILTER)
    .gte("start_at", `${from}T00:00:00`)
    .lt("start_at", `${toExclusive}T00:00:00`)
    .order("start_at", { ascending: false })
    .limit(200);

  if (service) query = query.eq("service_id", service);
  if (driver) query = query.eq("driver_id", driver);

  const { data: rows } = await query;
  const reports = (rows ?? []) as unknown as ReportRow[];

  if (reports.length === 0) {
    return (
      <EmptyState
        title="Aucun rapport exploitable"
        description="Dès qu'un chauffeur photographie sa feuille de tournée au départ ou au retour, les données lues automatiquement apparaîtront ici."
      />
    );
  }

  return <ReportsTable reports={reports} canEdit={canEdit} />;
}

async function PhotosView({
  supabase,
  from,
  toExclusive,
  service,
  driver,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  from: string;
  toExclusive: string;
  service: string;
  driver: string;
}) {
  let query = supabase
    .from("planning_entries")
    .select(
      "id, tour_number, start_at, start_photo_path, end_photo_path, report_bl_number, report_stops_total, report_packages_count, services(name), vehicles(registration), users!planning_entries_driver_id_fkey(full_name)",
    )
    .or("start_photo_path.not.is.null,end_photo_path.not.is.null")
    .gte("start_at", `${from}T00:00:00`)
    .lt("start_at", `${toExclusive}T00:00:00`)
    .order("start_at", { ascending: false })
    .limit(100);

  if (service) query = query.eq("service_id", service);
  if (driver) query = query.eq("driver_id", driver);

  const { data: rows } = await query;
  const photoRows = (rows ?? []) as unknown as PhotoRow[];

  if (photoRows.length === 0) {
    return (
      <EmptyState
        title="Aucune photo de rapport"
        description="Les photos prises par les chauffeurs au départ et au retour de tournée apparaîtront ici."
      />
    );
  }

  const withUrls = await Promise.all(
    photoRows.map(async (r) => {
      const [startUrl, endUrl] = await Promise.all([
        r.start_photo_path
          ? supabase.storage.from("tour-photos").createSignedUrl(r.start_photo_path, 600).then((res) => res.data?.signedUrl ?? null)
          : Promise.resolve(null),
        r.end_photo_path
          ? supabase.storage.from("tour-photos").createSignedUrl(r.end_photo_path, 600).then((res) => res.data?.signedUrl ?? null)
          : Promise.resolve(null),
      ]);
      return { ...r, startUrl, endUrl };
    }),
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {withUrls.map((r) => (
        <Card key={r.id} className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-medium">n°{r.tour_number}</p>
            <span className="text-xs text-navy/40">
              {new Date(r.start_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </span>
          </div>
          <p className="text-xs text-navy/60">
            {r.users?.full_name ?? "—"} · {r.services?.name ?? "—"} · {r.vehicles?.registration ?? "—"}
          </p>
          <div className="flex gap-2">
            {r.startUrl && (
              <a href={r.startUrl} target="_blank" rel="noreferrer" className="flex-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.startUrl} alt="Rapport départ" className="h-28 w-full rounded-lg border border-navy/10 object-cover" />
                <p className="mt-0.5 text-center text-[11px] text-navy/40">Départ</p>
              </a>
            )}
            {r.endUrl && (
              <a href={r.endUrl} target="_blank" rel="noreferrer" className="flex-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.endUrl} alt="Rapport retour" className="h-28 w-full rounded-lg border border-navy/10 object-cover" />
                <p className="mt-0.5 text-center text-[11px] text-navy/40">Retour</p>
              </a>
            )}
          </div>
          {(r.report_bl_number || r.report_stops_total !== null || r.report_packages_count !== null) && (
            <p className="rounded-lg bg-navy/5 px-2 py-1 text-[11px] text-navy/60">
              {[
                r.report_bl_number && `BL ${r.report_bl_number}`,
                r.report_stops_total !== null && `${r.report_stops_total} arrêts`,
                r.report_packages_count !== null && `${r.report_packages_count} colis`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
