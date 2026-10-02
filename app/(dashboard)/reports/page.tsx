import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { ReportsViewTabs } from "@/components/reports/ReportsViewTabs";

interface ReportRow {
  id: string;
  tour_number: string;
  start_at: string;
  report_bl_number: string | null;
  report_stops_total: number | null;
  report_packages_count: number | null;
  report_priority_count: number | null;
  report_stops_delivered: number | null;
  report_packages_missing: number | null;
  report_pickups: number | null;
  vehicles: { registration: string } | null;
  users: { full_name: string } | null;
}

interface PhotoRow {
  id: string;
  tour_number: string;
  start_at: string;
  start_photo_path: string | null;
  end_photo_path: string | null;
  report_bl_number: string | null;
  report_stops_total: number | null;
  report_packages_count: number | null;
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
].join(",");

/**
 * The data behind this page has been captured since Lot C (the
 * départ/retour tour photo → OCR extraction of "Num Tour / Num BL /
 * arrêts / colis…", see lib/ocr/tour-report.ts) but had no page
 * anywhere to show it — report_* columns (and the photos themselves)
 * on planning_entries were written and never read back. Two views:
 * "Tableau" (the extracted fields, structured) and "Photos" (the raw
 * captures, for visually checking a reading the OCR got wrong or
 * couldn't make out at all).
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
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

  return (
    <div>
      <PageHeader
        title="Rapports de tournée"
        description="Données lues automatiquement sur les photos de feuille de tournée (départ/retour) — numéro de BL, arrêts, colis."
      />
      <ReportsViewTabs view={view} />
      {view === "photos" ? <PhotosView supabase={supabase} /> : <TableView supabase={supabase} />}
    </div>
  );
}

async function TableView({ supabase }: { supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> }) {
  const { data: rows } = await supabase
    .from("planning_entries")
    .select(
      "id, tour_number, start_at, report_bl_number, report_stops_total, report_packages_count, report_priority_count, report_stops_delivered, report_packages_missing, report_pickups, vehicles(registration), users!planning_entries_driver_id_fkey(full_name)",
    )
    .or(REPORT_FIELDS_FILTER)
    .order("start_at", { ascending: false })
    .limit(200);

  const reports = (rows ?? []) as unknown as ReportRow[];

  if (reports.length === 0) {
    return (
      <EmptyState
        title="Aucun rapport exploitable"
        description="Dès qu'un chauffeur photographie sa feuille de tournée au départ ou au retour, les données lues automatiquement apparaîtront ici."
      />
    );
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="text-left text-navy/40">
          <tr>
            <th className="pb-2">Date</th>
            <th className="pb-2">Chauffeur</th>
            <th className="pb-2">Véhicule</th>
            <th className="pb-2">Tournée</th>
            <th className="pb-2">BL</th>
            <th className="pb-2">Arrêts</th>
            <th className="pb-2">Colis</th>
            <th className="pb-2">Priorité</th>
            <th className="pb-2">Ramasses</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} className="border-t border-navy/5">
              <td className="py-2">
                {new Date(r.start_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
              </td>
              <td className="py-2">{r.users?.full_name ?? "—"}</td>
              <td className="py-2">{r.vehicles?.registration ?? "—"}</td>
              <td className="py-2">n°{r.tour_number}</td>
              <td className="py-2">{r.report_bl_number ?? "—"}</td>
              <td className="py-2">
                {r.report_stops_delivered !== null || r.report_stops_total !== null
                  ? `${r.report_stops_delivered ?? "—"} / ${r.report_stops_total ?? "—"}`
                  : "—"}
              </td>
              <td className="py-2">
                {r.report_packages_count !== null || r.report_packages_missing !== null
                  ? `${r.report_packages_count ?? "—"}${r.report_packages_missing ? ` (${r.report_packages_missing} manquant(s))` : ""}`
                  : "—"}
              </td>
              <td className="py-2">{r.report_priority_count ?? "—"}</td>
              <td className="py-2">{r.report_pickups ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function PhotosView({ supabase }: { supabase: Awaited<ReturnType<typeof createServerSupabaseClient>> }) {
  const { data: rows } = await supabase
    .from("planning_entries")
    .select(
      "id, tour_number, start_at, start_photo_path, end_photo_path, report_bl_number, report_stops_total, report_packages_count, vehicles(registration), users!planning_entries_driver_id_fkey(full_name)",
    )
    .or("start_photo_path.not.is.null,end_photo_path.not.is.null")
    .order("start_at", { ascending: false })
    .limit(100);

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
            {r.users?.full_name ?? "—"} · {r.vehicles?.registration ?? "—"}
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
