import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { PayrollTable } from "@/components/payroll/PayrollTable";
import { PayrollFilters } from "@/components/payroll/PayrollFilters";
import { firstOfMonth, addMonths, currentMonth } from "@/lib/planning/dates";

interface DoneTour {
  driver_id: string | null;
  start_at: string;
  end_at: string;
}

/**
 * Direction-only — hours worked come from start_at/end_at, stamped by
 * the app at the moment of each QR scan (see app/api/tours/route.ts
 * and app/api/tours/[id]/route.ts), never from the OCR-read report_*
 * times printed on the bordereau itself (those can be a BL creation
 * time, not a real departure). hourly_rate is manual, per driver —
 * there's no "standard rate" to default to, each contract differs.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; driver?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    redirect("/dashboard");
  }

  const supabase = await createServerSupabaseClient();
  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");
  if (!planningEnabled) {
    return (
      <EmptyState
        title="Module Planning non activé"
        description="Le calcul des salaires dépend des heures de tournée (module Planning) — activez-le depuis les paramètres de votre organisation."
      />
    );
  }

  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const monthStart = firstOfMonth(month);
  const monthEnd = firstOfMonth(addMonths(month, 1));
  const selectedDriver = params.driver ?? "";

  const [{ data: drivers }, { data: toursData }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, hourly_rate")
      .eq("active", true)
      .in("role", ["chauffeur", "manager_chauffeur"])
      .order("full_name"),
    (() => {
      let query = supabase
        .from("planning_entries")
        .select("driver_id, start_at, end_at")
        .eq("status", "done")
        .not("driver_id", "is", null)
        .not("end_at", "is", null)
        .gte("start_at", `${monthStart}T00:00:00`)
        .lt("start_at", `${monthEnd}T00:00:00`);
      if (selectedDriver) query = query.eq("driver_id", selectedDriver);
      return query;
    })(),
  ]);

  const hoursByDriver = new Map<string, { hours: number; tours: number }>();
  for (const t of (toursData ?? []) as DoneTour[]) {
    if (!t.driver_id) continue;
    const hours = (new Date(t.end_at).getTime() - new Date(t.start_at).getTime()) / 3_600_000;
    const current = hoursByDriver.get(t.driver_id) ?? { hours: 0, tours: 0 };
    hoursByDriver.set(t.driver_id, { hours: current.hours + Math.max(hours, 0), tours: current.tours + 1 });
  }

  const rows = (drivers ?? [])
    .filter((d) => !selectedDriver || d.id === selectedDriver)
    .map((d) => {
      const worked = hoursByDriver.get(d.id) ?? { hours: 0, tours: 0 };
      return {
        driver_id: d.id,
        full_name: d.full_name,
        hourly_rate: d.hourly_rate,
        tours_count: worked.tours,
        worked_hours: worked.hours,
      };
    });

  return (
    <div>
      <PageHeader
        title="Salaires"
        description="Heures travaillées (scan départ → scan retour) × taux horaire — le taux est à ajuster au cas par cas selon le contrat de chaque chauffeur."
      />
      <PayrollFilters month={month} drivers={(drivers ?? []).map((d) => ({ id: d.id, full_name: d.full_name }))} selectedDriver={selectedDriver} />
      {rows.length === 0 ? (
        <EmptyState title="Aucun chauffeur" description="Aucun chauffeur actif à afficher." />
      ) : (
        <PayrollTable rows={rows} />
      )}
    </div>
  );
}
