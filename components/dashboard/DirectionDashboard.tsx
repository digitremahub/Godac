import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card } from "@/components/ui";
import { AlertList } from "@/components/alerts/AlertList";
import { BarChartCard, type BarDatum } from "@/components/reporting/BarChartCard";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";
import { addDays } from "@/lib/planning/dates";
import { TRUSTED_FUEL_STATUSES } from "@/lib/fuel/totals";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { parisDay, parisMidnightIso, parisMonthStartDay } from "@/lib/utils/paris-time";
import type { AppUser } from "@/lib/auth/session";
import { DriverRecoveryCodePanel } from "@/components/dashboard/DriverRecoveryCodePanel";

/**
 * Direction sees the whole organization: fleet + headcount KPIs,
 * pending approvals across every service, and (when BI reporting is
 * enabled) the same consolidated charts as the dedicated /reporting
 * page, surfaced here so the big picture doesn't require a second
 * click every morning.
 */
export async function DirectionDashboard({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const supabase = await createServerSupabaseClient();
  const biEnabled = enabledModules.includes("bi_reporting");
  const leaveEnabled = enabledModules.includes("leave_management");
  const maintenanceEnabled = enabledModules.includes("maintenance_requests");
  const payslipsEnabled = enabledModules.includes("payslips");

  // Bornes en heure de Paris (pas minuit UTC ni l'heure du serveur).
  const monthStartDate = parisMonthStartDay();
  const since30d = parisMidnightIso(addDays(parisDay(), -30));

  const [
    activeVehiclesRes,
    activeDriversRes,
    ongoingToursRes,
    openAlertsCountRes,
    openAlertsRes,
    pendingSignupsRes,
    pendingLeaveRes,
    openMaintenanceRes,
    activeUsersRes,
    payslipUserIdsRes,
    fuelRowsRes,
    tourRowsRes,
  ] = await Promise.all([
    supabase.from("vehicles").select("id, registration").eq("status", "active"),
    supabase.from("users").select("id", { count: "exact", head: true }).in("role", ["chauffeur", "manager_chauffeur"]).eq("active", true),
    supabase.from("planning_entries").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("alerts")
      .select("id, type, severity, message, status, notified_at, created_at, related_table, related_id")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("users").select("id", { count: "exact", head: true }).eq("organization_id", appUser.organization_id).eq("pending_approval", true),
    leaveEnabled
      ? supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: null }),
    maintenanceEnabled
      ? supabase.from("vehicle_interventions").select("id", { count: "exact", head: true }).not("status", "in", "(done,cancelled)")
      : Promise.resolve({ count: null }),
    payslipsEnabled
      ? supabase.from("users").select("id").eq("organization_id", appUser.organization_id).eq("active", true)
      : Promise.resolve({ data: null }),
    payslipsEnabled
      ? supabase.from("payslips").select("user_id").gte("period_start", monthStartDate)
      : Promise.resolve({ data: null }),
    // Pleins de confiance uniquement, toutes les lignes (pas de .limit()
    // qui tronquait les totaux en silence).
    biEnabled
      ? fetchAllRows((a, b) =>
          supabase
            .from("fuel_entries")
            .select("liters, total_amount, status, product, vehicles(registration)")
            .in("status", [...TRUSTED_FUEL_STATUSES])
            .gte("occurred_at", since30d)
            .order("id")
            .range(a, b),
        )
      : Promise.resolve(null),
    biEnabled
      ? fetchAllRows((a, b) =>
          supabase
            .from("planning_entries")
            .select("status, services(name)")
            .in("status", ["in_progress", "done"])
            .gte("start_at", since30d)
            .order("id")
            .range(a, b),
        )
      : Promise.resolve(null),
  ]);

  const openAlerts = (openAlertsRes.data ?? []) as any[];
  const { data: pinDrivers } = await supabase
    .from("users")
    .select("id, full_name, phone")
    .eq("organization_id", appUser.organization_id)
    .eq("auth_method", "pin")
    .eq("active", true)
    .eq("pending_approval", false)
    .order("full_name");

  const consumptionRanking = (
    await Promise.all(
      ((activeVehiclesRes.data ?? []) as { id: string; registration: string }[]).map(async (v) => ({
        registration: v.registration,
        consumption: await getVehicleConsumption(supabase, v.id, 30),
      })),
    )
  )
    .filter((v): v is { registration: string; consumption: number } => v.consumption !== null)
    .sort((a, b) => b.consumption - a.consumption)
    .slice(0, 5);

  const missingPayslips = payslipsEnabled
    ? (activeUsersRes.data ?? []).length - new Set((payslipUserIdsRes.data ?? []).map((p: any) => p.user_id)).size
    : null;

  let fuelCostByVehicle: BarDatum[] = [];
  let toursByService: BarDatum[] = [];
  if (biEnabled) {
    const costByVehicle = new Map<string, number>();
    for (const r of (fuelRowsRes?.rows ?? []) as any[]) {
      const name = r.vehicles?.registration ?? "—";
      costByVehicle.set(name, (costByVehicle.get(name) ?? 0) + Number(r.total_amount ?? 0));
    }
    fuelCostByVehicle = Array.from(costByVehicle, ([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const toursByServiceMap = new Map<string, number>();
    for (const r of (tourRowsRes?.rows ?? []) as any[]) {
      const name = r.services?.name ?? "—";
      toursByServiceMap.set(name, (toursByServiceMap.get(name) ?? 0) + 1);
    }
    toursByService = Array.from(toursByServiceMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }

  const pendingTiles: { label: string; value: number; accent: "teal" | "orange" | "gold"; href: string }[] = [
    { label: "Nouveaux chauffeurs à valider", value: pendingSignupsRes.count ?? 0, accent: "teal", href: "/driver-signups" },
  ];
  if (leaveEnabled) pendingTiles.push({ label: "Congés à valider", value: pendingLeaveRes.count ?? 0, accent: "gold", href: "/leaves" });
  if (maintenanceEnabled)
    pendingTiles.push({ label: "Demandes d'entretien ouvertes", value: openMaintenanceRes.count ?? 0, accent: "orange", href: "/maintenance" });
  if (payslipsEnabled && missingPayslips !== null)
    pendingTiles.push({ label: "Fiches de paie manquantes ce mois", value: missingPayslips, accent: missingPayslips > 0 ? "orange" : "teal", href: "/payslips" });

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Vue d'ensemble de l'organisation." />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Véhicules actifs" value={String((activeVehiclesRes.data ?? []).length)} />
        <StatTile label="Chauffeurs actifs" value={String(activeDriversRes.count ?? 0)} accent="gold" />
        <Link href="/tours/history" className="block">
          <StatTile label="Tournées en cours" value={String(ongoingToursRes.count ?? 0)} accent="teal" />
        </Link>
        <Link href="/alerts" className="block">
          <StatTile label="Alertes ouvertes" value={String(openAlertsCountRes.count ?? 0)} accent={openAlertsCountRes.count ? "orange" : "teal"} />
        </Link>
      </div>

      <DriverRecoveryCodePanel drivers={(pinDrivers ?? []) as { id: string; full_name: string; phone: string | null }[]} />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {pendingTiles.map((t) => (
          <Link key={t.label} href={t.href} className="block">
            <StatTile label={t.label} value={String(t.value)} accent={t.accent} />
          </Link>
        ))}
      </div>

      {biEnabled && (
        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg">Reporting (30 jours)</h2>
            <Link href="/reporting" className="text-sm text-teal-ink hover:underline">
              Voir le reporting complet →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarChartCard title="Coût carburant par véhicule (top 8)" data={fuelCostByVehicle} valueSuffix=" €" />
            <BarChartCard title="Tournées par service" data={toursByService} />
          </div>
          {(fuelRowsRes?.truncated || tourRowsRes?.truncated) && (
            <p className="mt-2 text-xs text-orange-ink">Résultats tronqués : trop de lignes sur la période, les totaux sont incomplets.</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-lg">Consommation (30 jours)</h2>
          {consumptionRanking.length === 0 ? (
            <p className="text-sm text-navy/60">Pas assez de données pour établir un classement.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {consumptionRanking.map((v) => (
                <li key={v.registration} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
                  <span>{v.registration}</span>
                  <span className="font-medium">{v.consumption} L/100km</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          <h2 className="mb-3 text-lg">Notifications</h2>
          <AlertList alerts={openAlerts} viewerRole={appUser.role} />
        </div>
      </div>
    </div>
  );
}
