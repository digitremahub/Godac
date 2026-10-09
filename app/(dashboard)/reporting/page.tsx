import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, StatTile, EmptyState } from "@/components/ui";
import { BarChartCard, type BarDatum } from "@/components/reporting/BarChartCard";
import { addDays, todayISO } from "@/lib/planning/dates";

/**
 * Module Reporting BI — a consolidated read-only view over data
 * already captured elsewhere (carburant, tournées), not a new data
 * source. Direction-only: it aggregates across every service/vehicle
 * at once, which is exactly what a service-scoped manager shouldn't
 * see in one screen.
 */
export default async function ReportingPage() {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return (
      <EmptyState title="Réservé à la direction" description="Le reporting consolidé n'est visible que par les comptes direction." />
    );
  }

  const supabase = await createServerSupabaseClient();
  const biEnabled = await isModuleEnabled(supabase, appUser.organization_id, "bi_reporting");
  if (!biEnabled) {
    return (
      <EmptyState
        title="Module Reporting BI non activé"
        description="Activez-le depuis les paramètres de votre organisation pour consolider carburant et tournées."
      />
    );
  }

  const from = addDays(todayISO(), -30);

  const [{ data: fuelRows }, { data: tourRows }] = await Promise.all([
    supabase.from("fuel_entries").select("liters, total_amount, vehicles(registration)").gte("occurred_at", `${from}T00:00:00`).limit(2000),
    supabase
      .from("planning_entries")
      .select("status, services(name)")
      .in("status", ["in_progress", "done"])
      .gte("start_at", `${from}T00:00:00`)
      .limit(2000),
  ]);

  const totalLiters = (fuelRows ?? []).reduce((sum, r) => sum + Number(r.liters ?? 0), 0);
  const totalFuelCost = (fuelRows ?? []).reduce((sum, r) => sum + Number(r.total_amount ?? 0), 0);
  const toursCount = (tourRows ?? []).length;

  const costByVehicle = new Map<string, number>();
  for (const r of fuelRows ?? []) {
    const name = (r.vehicles as any)?.registration ?? "—";
    costByVehicle.set(name, (costByVehicle.get(name) ?? 0) + Number(r.total_amount ?? 0));
  }
  const fuelCostByVehicle: BarDatum[] = Array.from(costByVehicle, ([name, value]) => ({ name, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const toursByServiceMap = new Map<string, number>();
  for (const r of tourRows ?? []) {
    const name = (r.services as any)?.name ?? "—";
    toursByServiceMap.set(name, (toursByServiceMap.get(name) ?? 0) + 1);
  }
  const toursByService: BarDatum[] = Array.from(toursByServiceMap, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  return (
    <div>
      <PageHeader title="Reporting BI" description="Consolidé carburant et tournées sur les 30 derniers jours." />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Carburant (30 j)" value={`${Math.round(totalFuelCost).toLocaleString("fr-FR")} €`} />
        <StatTile label="Litres (30 j)" value={`${Math.round(totalLiters).toLocaleString("fr-FR")} L`} accent="gold" />
        <StatTile label="Tournées (30 j)" value={toursCount.toString()} accent="orange" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarChartCard title="Coût carburant par véhicule (top 8)" data={fuelCostByVehicle} valueSuffix=" €" />
        <BarChartCard title="Tournées par service" data={toursByService} />
      </div>
    </div>
  );
}
