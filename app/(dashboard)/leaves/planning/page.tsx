import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { LeavePlanningCalendar } from "@/components/leaves/LeavePlanningCalendar";
import { firstOfMonth, addMonths, addDays, currentMonth } from "@/lib/planning/dates";

/**
 * Direction's own "qui couvre qui" view — separate from the work
 * planning (planning_entries, /planning): this is about absence
 * coverage (leave_requests), not tours/vehicles. A manager approves a
 * leave on /leaves same as before; this page is only for assigning
 * who replaces them, across the whole organisation at a glance.
 */
export default async function LeavePlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const g = await garderPage("equipe.conges_calendrier");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;

  const supabase = await createServerSupabaseClient();

  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const monthStart = firstOfMonth(month);
  const monthEnd = addDays(firstOfMonth(addMonths(month, 1)), -1);

  const [{ data: leaves }, { data: drivers }] = await Promise.all([
    supabase
      .from("leave_requests")
      .select(
        "id, driver_id, service_id, start_date, end_date, status, replacement_driver_id, users!leave_requests_driver_id_fkey(full_name), services(name), replacement:users!leave_requests_replacement_driver_id_fkey(full_name)",
      )
      // Any leave overlapping the visible month, not just ones starting in it.
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart)
      .order("start_date"),
    supabase.from("users").select("id, full_name, role").eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
  ]);

  return (
    <div>
      <PageHeader
        title="Planning congés & remplacements"
        description="Vue d'ensemble des absences approuvées et des remplacements assignés — distincte du planning de travail."
      />
      <LeavePlanningCalendar
        month={month}
        leaves={(leaves ?? []).map((l: any) => ({
          id: l.id,
          driverId: l.driver_id,
          driverName: l.users?.full_name ?? "—",
          serviceName: l.services?.name ?? "—",
          startDate: l.start_date,
          endDate: l.end_date,
          status: l.status,
          replacementDriverId: l.replacement_driver_id,
          replacementName: l.replacement?.full_name ?? null,
        }))}
        drivers={(drivers ?? []).map((d) => ({ id: d.id, full_name: d.full_name }))}
      />
    </div>
  );
}
