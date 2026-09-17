import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { PlanningGrid } from "@/components/planning/PlanningGrid";

function mondayOf(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; service?: string }>;
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

  const isDirection = appUser.role === "direction";
  const weekStartDate = mondayOf(params.week && !Number.isNaN(Date.parse(params.week)) ? new Date(params.week) : new Date());
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 7);
  const prevWeekDate = new Date(weekStartDate);
  prevWeekDate.setDate(prevWeekDate.getDate() - 7);
  const nextWeekDate = new Date(weekStartDate);
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);

  const [{ data: allServices }, { data: myServiceRows }, { data: vehicles }, { data: drivers }, { data: entries }] =
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
          "id, service_id, tour_number, driver_id, vehicle_id, start_at, status, vehicles(registration), users!planning_entries_driver_id_fkey(full_name)",
        )
        .gte("start_at", weekStartDate.toISOString())
        .lt("start_at", weekEndDate.toISOString())
        .order("start_at"),
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

  return (
    <div>
      <PageHeader
        title="Planning"
        description="Tous les services, véhicules et chauffeurs — glissez une affectation vers un autre jour pour la déplacer."
      />
      <PlanningGrid
        services={services}
        filteredServices={filteredServices}
        vehicles={vehicles ?? []}
        drivers={drivers ?? []}
        entries={(entries ?? []) as any}
        weekStart={toISODate(weekStartDate)}
        prevWeek={toISODate(prevWeekDate)}
        nextWeek={toISODate(nextWeekDate)}
        selectedService={params.service ?? ""}
      />
    </div>
  );
}
