import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";

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
 * arrêts / colis…", see lib/ocr/tour-report.ts) but had no table
 * anywhere to show it — report_* columns on planning_entries were
 * written and never read back. This is that table.
 */
export default async function ReportsPage() {
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

  const { data: rows } = await supabase
    .from("planning_entries")
    .select(
      "id, tour_number, start_at, report_bl_number, report_stops_total, report_packages_count, report_priority_count, report_stops_delivered, report_packages_missing, report_pickups, vehicles(registration), users!planning_entries_driver_id_fkey(full_name)",
    )
    .or(REPORT_FIELDS_FILTER)
    .order("start_at", { ascending: false })
    .limit(200);

  const reports = (rows ?? []) as unknown as ReportRow[];

  return (
    <div>
      <PageHeader
        title="Rapports de tournée"
        description="Données lues automatiquement sur les photos de feuille de tournée (départ/retour) — numéro de BL, arrêts, colis."
      />

      {reports.length === 0 ? (
        <EmptyState
          title="Aucun rapport exploitable"
          description="Dès qu'un chauffeur photographie sa feuille de tournée au départ ou au retour, les données lues automatiquement apparaîtront ici."
        />
      ) : (
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
      )}
    </div>
  );
}
