import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { PayrollTable } from "@/components/payroll/PayrollTable";
import { PayrollFilters } from "@/components/payroll/PayrollFilters";
import { firstOfMonth, addMonths, addDays, currentMonth } from "@/lib/planning/dates";
import { computeHourlyRates } from "@/lib/business/payroll";

interface BadgeEntry {
  user_id: string;
  clocked_in_at: string;
  clocked_out_at: string;
}

interface DoneTour {
  driver_id: string | null;
}

/**
 * Direction-only — hours worked come from clocked_in_at/clocked_out_at
 * (module Pointeuse, see app/(dashboard)/time-clock), the actual
 * badge-in/badge-out of the shift — never from a tour's start_at/
 * end_at (QR scan at departure/return), which only brackets the
 * delivery round itself, not the full paid shift (pre/post-tour tasks
 * fall outside it). hourly_rate is manual, per driver — there's no
 * "standard rate" to default to, each contract differs. Tour count
 * stays a separate, planning-sourced stat (when that module is also
 * enabled) — informative, not part of the hours calculation.
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
  const timeClockEnabled = await isModuleEnabled(supabase, appUser.organization_id, "time_clock");
  if (!timeClockEnabled) {
    return (
      <EmptyState
        title="Module Pointeuse non activé"
        description="Le calcul des salaires dépend des heures badgées (module Pointeuse électronique) — activez-le depuis les paramètres de votre organisation."
      />
    );
  }
  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");

  const month = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth();
  const monthStart = firstOfMonth(month);
  const monthEnd = firstOfMonth(addMonths(month, 1));
  // Last calendar day of `month` — matches exactly what
  // GeneratePayslipForm/payroll's own "générer" button already sends
  // as period_end (firstAndLastOfMonth), so a payslip row for this
  // month is found by period_start/period_end alone, not a range scan.
  const periodEnd = addDays(monthEnd, -1);
  const selectedDriver = params.driver ?? "";
  const payslipsEnabled = await isModuleEnabled(supabase, appUser.organization_id, "payslips");

  const [{ data: drivers }, { data: contracts }, { data: badgeData }, { data: toursData }, { data: existingPayslips }] = await Promise.all([
    supabase.from("users").select("id, full_name").eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
    // Separate table (not a column on `users`, whose RLS lets any org
    // member read any row) — see 20260101000077.
    supabase.from("user_contracts").select("user_id, monthly_gross_salary, monthly_net_salary, contractual_monthly_hours"),
    (() => {
      let query = supabase
        .from("time_clock_entries")
        .select("user_id, clocked_in_at, clocked_out_at")
        .not("clocked_out_at", "is", null)
        .gte("clocked_in_at", `${monthStart}T00:00:00`)
        .lt("clocked_in_at", `${monthEnd}T00:00:00`);
      if (selectedDriver) query = query.eq("user_id", selectedDriver);
      return query;
    })(),
    planningEnabled
      ? (() => {
          let query = supabase
            .from("planning_entries")
            .select("driver_id")
            .eq("status", "done")
            .not("driver_id", "is", null)
            .gte("start_at", `${monthStart}T00:00:00`)
            .lt("start_at", `${monthEnd}T00:00:00`);
          if (selectedDriver) query = query.eq("driver_id", selectedDriver);
          return query;
        })()
      : Promise.resolve({ data: null }),
    payslipsEnabled
      ? supabase.from("payslips").select("user_id").eq("period_start", monthStart).eq("period_end", periodEnd)
      : Promise.resolve({ data: null }),
  ]);

  const generatedDriverIds = (existingPayslips ?? []).map((p) => p.user_id);

  const hoursByDriver = new Map<string, number>();
  for (const b of (badgeData ?? []) as BadgeEntry[]) {
    const hours = (new Date(b.clocked_out_at).getTime() - new Date(b.clocked_in_at).getTime()) / 3_600_000;
    hoursByDriver.set(b.user_id, (hoursByDriver.get(b.user_id) ?? 0) + Math.max(hours, 0));
  }

  const toursByDriver = new Map<string, number>();
  for (const t of (toursData ?? []) as DoneTour[]) {
    if (!t.driver_id) continue;
    toursByDriver.set(t.driver_id, (toursByDriver.get(t.driver_id) ?? 0) + 1);
  }

  const contractByDriver = new Map((contracts ?? []).map((c) => [c.user_id, c]));

  const rows = (drivers ?? [])
    .filter((d) => !selectedDriver || d.id === selectedDriver)
    .map((d) => {
      const contract = contractByDriver.get(d.id);
      const monthlyGross = contract?.monthly_gross_salary !== undefined && contract.monthly_gross_salary !== null ? Number(contract.monthly_gross_salary) : null;
      const monthlyNet = contract?.monthly_net_salary !== undefined && contract.monthly_net_salary !== null ? Number(contract.monthly_net_salary) : null;
      const contractualHours = contract ? Number(contract.contractual_monthly_hours) : 151.67;
      const rates = computeHourlyRates({
        monthlyGrossSalary: monthlyGross,
        monthlyNetSalary: monthlyNet,
        contractualMonthlyHours: contractualHours,
      });
      return {
        driver_id: d.id,
        full_name: d.full_name,
        monthly_gross_salary: monthlyGross,
        monthly_net_salary: monthlyNet,
        contractual_monthly_hours: contractualHours,
        hourly_rates: rates,
        tours_count: toursByDriver.get(d.id) ?? 0,
        worked_hours: hoursByDriver.get(d.id) ?? 0,
        payslip_generated: generatedDriverIds.includes(d.id),
      };
    });

  return (
    <div>
      <PageHeader
        title="Salaires"
        description="Heures travaillées (badge entrée → badge sortie) × taux horaire — le taux est à ajuster au cas par cas selon le contrat de chaque chauffeur."
      />
      <PayrollFilters month={month} drivers={(drivers ?? []).map((d) => ({ id: d.id, full_name: d.full_name }))} selectedDriver={selectedDriver} />
      {rows.length === 0 ? (
        <EmptyState title="Aucun chauffeur" description="Aucun chauffeur actif à afficher." />
      ) : (
        <PayrollTable rows={rows} payslipsEnabled={payslipsEnabled} periodStart={monthStart} periodEnd={periodEnd} />
      )}
    </div>
  );
}
