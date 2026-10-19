import { garderPage } from "@/lib/acces/garde-page";
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
  const { appUser, supabase } = g;

  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const monthStart = firstOfMonth(month);
  const monthEnd = addDays(firstOfMonth(addMonths(month, 1)), -1);

  const [{ data: leaves }, { data: tousChauffeurs }, { data: rattachements }] = await Promise.all([
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
    supabase.from("user_services").select("user_id, service_id"),
  ]);
  // Décision client Q4 : les managers voient le calendrier de leur service
  // (la RLS de leave_requests filtre déjà les absences).
  const mesServices = new Set((rattachements ?? []).filter((r) => r.user_id === appUser.id).map((r) => r.service_id));
  const duService = new Set((rattachements ?? []).filter((r) => mesServices.has(r.service_id)).map((r) => r.user_id));
  const drivers = appUser.role === "direction" ? tousChauffeurs : (tousChauffeurs ?? []).filter((d) => duService.has(d.id));

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
