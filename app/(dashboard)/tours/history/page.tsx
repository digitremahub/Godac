import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { TourHistoryFilters } from "@/components/tours/TourHistoryFilters";
import { TourHistoryTable, type TourHistoryRow } from "@/components/tours/TourHistoryTable";
import { MonthlyEarningsCard } from "@/components/tours/MonthlyEarningsCard";
import { addDays, todayISO, firstOfMonth, addMonths, currentMonth } from "@/lib/planning/dates";
import { estimateReturnDistanceDeltaKm } from "@/lib/business/fuel-profitability";
import { computeHourlyRates, estimateSalary, countWeekdays, leaveDayHoursEquivalent } from "@/lib/business/payroll";

const STATUS_LABEL: Record<string, string> = { planned: "Prévue", in_progress: "En cours", done: "Terminée" };
const RETURN_TYPE_LABEL: Record<string, string> = { depot: "Dépôt", domicile: "Domicile" };

interface HistoryRow {
  id: string;
  tour_number: string;
  start_at: string;
  end_at: string | null;
  status: string;
  start_km: number | null;
  end_km: number | null;
  start_photo_path: string | null;
  end_photo_path: string | null;
  return_type: "depot" | "domicile" | null;
  services: { name: string } | null;
  vehicles: { registration: string } | null;
  users: { full_name: string; address_lat: number | null; address_lng: number | null } | null;
}

/**
 * "Historique de tournées visible par rôle" — past tours (in_progress
 * or done; "planned" stays on the /planning tab, that's the future).
 * A chauffeur only ever sees their own (driver_id forced server-side,
 * never trusted from a query param); exploitation (manager/
 * manager_chauffeur) is scoped to their own service(s), same
 * convention as /planning; direction sees the whole organisation and
 * additionally gets a service filter.
 */
export default async function TourHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; service?: string; driver?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");
  if (!planningEnabled) {
    return (
      <EmptyState
        title="Module Planning non activé"
        description="L'historique des tournées dépend du module Planning — activez-le depuis les paramètres de votre organisation."
      />
    );
  }

  const isDirection = appUser.role === "direction";
  const isChauffeur = appUser.role === "chauffeur";

  const from = params.from && !Number.isNaN(Date.parse(params.from)) ? params.from : addDays(todayISO(), -30);
  const to = params.to && !Number.isNaN(Date.parse(params.to)) ? params.to : todayISO();
  const toExclusive = addDays(to, 1);

  const [{ data: allServices }, { data: myServiceRows }, { data: drivers }, { data: organization }] = await Promise.all([
    isDirection ? supabase.from("services").select("id, name").order("name") : Promise.resolve({ data: null }),
    isDirection || isChauffeur
      ? Promise.resolve({ data: null })
      : supabase.from("user_services").select("services(id, name)").eq("user_id", appUser.id),
    isChauffeur
      ? Promise.resolve({ data: null })
      : supabase.from("users").select("id, full_name").eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
    supabase.from("organizations").select("depot_lat, depot_lng").eq("id", appUser.organization_id).single(),
  ]);

  const depotCoords =
    organization?.depot_lat !== null && organization?.depot_lng !== null && organization
      ? { lat: Number(organization.depot_lat), lng: Number(organization.depot_lng) }
      : null;

  const services = isDirection ? (allServices ?? []) : ((myServiceRows ?? []) as any[]).map((r) => r.services).filter(Boolean);
  const myServiceIds = services.map((s: any) => s.id);

  let query = supabase
    .from("planning_entries")
    .select(
      "id, tour_number, start_at, end_at, status, start_km, end_km, start_photo_path, end_photo_path, return_type, services(name), vehicles(registration), users!planning_entries_driver_id_fkey(full_name, address_lat, address_lng)",
    )
    .in("status", ["in_progress", "done"])
    .gte("start_at", `${from}T00:00:00`)
    .lt("start_at", `${toExclusive}T00:00:00`)
    .order("start_at", { ascending: false })
    .limit(300);

  if (isChauffeur) {
    // Never trusts a query param for this — a driver's own id only.
    query = query.eq("driver_id", appUser.id);
  } else {
    if (!isDirection) query = query.in("service_id", myServiceIds.length > 0 ? myServiceIds : ["00000000-0000-0000-0000-000000000000"]);
    if (params.service) query = query.eq("service_id", params.service);
    if (params.driver) query = query.eq("driver_id", params.driver);
  }

  const { data: rows } = await query;
  const history = (rows ?? []) as unknown as HistoryRow[];

  // Own running month-to-date earnings estimate — chauffeur only, and
  // always this own user's data (RLS on user_contracts already backs
  // this up, see 20260101000077), never another driver's.
  let monthlyEarnings: {
    workedHours: number;
    absenceWeekdays: number;
    estimate: { gross: number | null; net: number | null } | null;
    hasContract: boolean;
  } | null = null;
  if (isChauffeur) {
    const month = currentMonth();
    const monthStart = firstOfMonth(month);
    const monthEnd = firstOfMonth(addMonths(month, 1));

    const [{ data: contract }, { data: doneTours }, { data: leaves }] = await Promise.all([
      supabase
        .from("user_contracts")
        .select("monthly_gross_salary, monthly_net_salary, contractual_monthly_hours")
        .eq("user_id", appUser.id)
        .maybeSingle(),
      supabase
        .from("planning_entries")
        .select("start_at, end_at")
        .eq("driver_id", appUser.id)
        .eq("status", "done")
        .not("end_at", "is", null)
        .gte("start_at", `${monthStart}T00:00:00`)
        .lt("start_at", `${monthEnd}T00:00:00`),
      supabase
        .from("leave_requests")
        .select("start_date, end_date")
        .eq("driver_id", appUser.id)
        .eq("status", "approved")
        .lt("start_date", monthEnd)
        .gte("end_date", monthStart),
    ]);

    const workedHours = (doneTours ?? []).reduce((sum, t) => {
      if (!t.end_at) return sum;
      const hours = (new Date(t.end_at).getTime() - new Date(t.start_at).getTime()) / 3_600_000;
      return sum + Math.max(hours, 0);
    }, 0);

    const contractualHours = contract ? Number(contract.contractual_monthly_hours) : 151.67;
    const lastDayOfMonth = addDays(monthEnd, -1);
    const absenceWeekdays = (leaves ?? []).reduce((sum, l) => {
      const clampedStart = l.start_date < monthStart ? monthStart : l.start_date;
      const clampedEnd = l.end_date > lastDayOfMonth ? lastDayOfMonth : l.end_date;
      if (clampedEnd < clampedStart) return sum;
      return sum + countWeekdays(new Date(`${clampedStart}T00:00:00Z`), new Date(`${clampedEnd}T00:00:00Z`));
    }, 0);

    const rates = contract
      ? computeHourlyRates({
          monthlyGrossSalary: contract.monthly_gross_salary !== null ? Number(contract.monthly_gross_salary) : null,
          monthlyNetSalary: contract.monthly_net_salary !== null ? Number(contract.monthly_net_salary) : null,
          contractualMonthlyHours: contractualHours,
        })
      : null;
    const totalHours = workedHours + absenceWeekdays * leaveDayHoursEquivalent(contractualHours);

    monthlyEarnings = {
      workedHours,
      absenceWeekdays,
      estimate: estimateSalary(totalHours, rates),
      hasContract: Boolean(contract),
    };
  }

  return (
    <div>
      <PageHeader
        title="Historique des tournées"
        description={
          isChauffeur
            ? "Vos tournées passées."
            : "Tournées passées de votre périmètre — démarrées ou terminées."
        }
      />

      {monthlyEarnings && <MonthlyEarningsCard {...monthlyEarnings} />}

      {!isChauffeur && (
        <TourHistoryFilters
          from={from}
          to={to}
          services={isDirection ? services : []}
          drivers={drivers ?? []}
          selectedService={params.service ?? ""}
          selectedDriver={params.driver ?? ""}
        />
      )}

      {history.length === 0 ? (
        <EmptyState title="Aucune tournée sur cette période" />
      ) : (
        <TourHistoryTable
          showDriverColumn={!isChauffeur}
          canEditKm={isDirection}
          rows={history.map((r): TourHistoryRow => {
            const homeCoords =
              r.users?.address_lat !== null && r.users?.address_lng !== null && r.users
                ? { lat: Number(r.users.address_lat), lng: Number(r.users.address_lng) }
                : null;
            const returnDelta = estimateReturnDistanceDeltaKm(r.return_type, depotCoords, homeCoords);
            return {
              id: r.id,
              dateLabel: new Date(r.start_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
              driverName: r.users?.full_name ?? null,
              serviceName: r.services?.name ?? "—",
              vehicleRegistration: r.vehicles?.registration ?? "—",
              tourNumber: r.tour_number,
              scheduleLabel:
                new Date(r.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) +
                (r.end_at ? ` → ${new Date(r.end_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : " → en cours"),
              startKm: r.start_km,
              endKm: r.end_km,
              startPhotoPath: r.start_photo_path,
              endPhotoPath: r.end_photo_path,
              returnLabel: r.return_type ? (RETURN_TYPE_LABEL[r.return_type] ?? "—") : "—",
              returnDeltaLabel:
                r.return_type === "domicile" ? (returnDelta !== null ? `(≈${returnDelta} km vs dépôt)` : "(adresse manquante)") : null,
              statusLabel: STATUS_LABEL[r.status] ?? r.status,
            };
          })}
        />
      )}
    </div>
  );
}
