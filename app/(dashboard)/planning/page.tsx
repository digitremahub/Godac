import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { PlanningGrid } from "@/components/planning/PlanningGrid";
import { PlanningViewTabs } from "@/components/planning/PlanningViewTabs";
import { PlanningDayView } from "@/components/planning/PlanningDayView";
import { PlanningMonthView } from "@/components/planning/PlanningMonthView";
import { PlanningKanbanView } from "@/components/planning/PlanningKanbanView";
import { PlanningListView } from "@/components/planning/PlanningListView";
import { mondayOf, toISODate, addDays, todayISO, firstOfMonth, addMonths, currentMonth, monthCalendarDays } from "@/lib/planning/dates";

type PlanningView = "week" | "day" | "month" | "kanban" | "list";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; day?: string; month?: string; service?: string; view?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");
  if (!planningEnabled) {
    return (
      <EmptyState
        title="Module Planning non activé"
        description="Activez-le depuis les paramètres de votre organisation."
      />
    );
  }

  const view: PlanningView = (["week", "day", "month", "kanban", "list"] as const).includes(params.view as PlanningView)
    ? (params.view as PlanningView)
    : "week";
  const isDirection = appUser.role === "direction";

  const weekStartDate = mondayOf(params.week && !Number.isNaN(Date.parse(params.week)) ? new Date(params.week) : new Date());
  const weekStart = toISODate(weekStartDate);
  const selectedDay = params.day && !Number.isNaN(Date.parse(params.day)) ? params.day : todayISO();
  const selectedMonth = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();

  // Week/kanban/list all read one week of data; day reads a single
  // day; month reads the whole calendar-grid range (including the
  // leading/trailing days from adjacent months the grid itself shows).
  let rangeStart: string;
  let rangeEnd: string;
  if (view === "day") {
    rangeStart = selectedDay;
    rangeEnd = addDays(selectedDay, 1);
  } else if (view === "month") {
    const calendarDays = monthCalendarDays(selectedMonth);
    rangeStart = calendarDays[0] ?? `${selectedMonth}-01`;
    rangeEnd = addDays(calendarDays[calendarDays.length - 1] ?? rangeStart, 1);
  } else {
    rangeStart = weekStart;
    rangeEnd = addDays(weekStart, 7);
  }

  const [{ data: allServices }, { data: myServiceRows }, { data: vehicles }, { data: drivers }, { data: entries }, { data: lastTours }] =
    await Promise.all([
      isDirection ? supabase.from("services").select("id, name").order("name") : Promise.resolve({ data: null }),
      isDirection
        ? Promise.resolve({ data: null })
        : supabase.from("user_services").select("services(id, name)").eq("user_id", appUser.id),
      supabase.from("vehicles").select("id, registration, service_id").order("registration"),
      supabase
        .from("users")
        .select("id, full_name")
        .eq("active", true)
        .in("role", ["chauffeur", "manager_chauffeur"])
        .order("full_name"),
      supabase
        .from("planning_entries")
        .select(
          "id, service_id, tour_number, driver_id, vehicle_id, start_at, status, vehicles(registration), users!planning_entries_driver_id_fkey(full_name, phone, email)",
        )
        .gte("start_at", `${rangeStart}T00:00:00`)
        .lt("start_at", `${rangeEnd}T00:00:00`)
        .order("start_at"),
      // Lot: "affectation automatique à la dernière tournée" — most
      // recent entry per driver, any week, used to pre-fill the
      // manual-assignment form (see PlanningGrid). Fetched here rather
      // than with a `distinct on` (not available through supabase-js)
      // and reduced to one row per driver below.
      supabase
        .from("planning_entries")
        .select("driver_id, vehicle_id, tour_number, start_at")
        .not("driver_id", "is", null)
        .order("start_at", { ascending: false })
        .limit(500),
    ]);

  const services = isDirection
    ? (allServices ?? [])
    : ((myServiceRows ?? []) as any[]).map((r) => r.services).filter(Boolean);

  if (services.length === 0) {
    return (
      <EmptyState
        title="Aucun service géré"
        description="Vous devez être rattaché à un service (voir Organisation > Utilisateurs) pour construire son planning."
      />
    );
  }

  const filteredServices = params.service ? services.filter((s: any) => s.id === params.service) : services;

  const lastTourByDriver = new Map<string, { vehicleId: string; tourNumber: string }>();
  for (const row of (lastTours ?? []) as any[]) {
    if (!lastTourByDriver.has(row.driver_id) && row.vehicle_id) {
      lastTourByDriver.set(row.driver_id, { vehicleId: row.vehicle_id, tourNumber: row.tour_number });
    }
  }

  const commonProps = {
    services,
    filteredServices,
    vehicles: vehicles ?? [],
    drivers: drivers ?? [],
    entries: (entries ?? []) as any,
    selectedService: params.service ?? "",
  };

  return (
    <div>
      <PageHeader
        title="Planning"
        description="Tous les services, véhicules et chauffeurs — glissez une affectation vers un autre jour pour la déplacer."
      />
      <PlanningViewTabs view={view} selectedService={params.service ?? ""} />
      {view === "week" && (
        <PlanningGrid
          {...commonProps}
          weekStart={weekStart}
          prevWeek={addDays(weekStart, -7)}
          nextWeek={addDays(weekStart, 7)}
          lastTourByDriver={Object.fromEntries(lastTourByDriver)}
        />
      )}
      {view === "day" && <PlanningDayView {...commonProps} day={selectedDay} />}
      {view === "month" && <PlanningMonthView {...commonProps} month={selectedMonth} />}
      {view === "kanban" && <PlanningKanbanView {...commonProps} weekStart={weekStart} />}
      {view === "list" && <PlanningListView {...commonProps} weekStart={weekStart} />}
    </div>
  );
}
