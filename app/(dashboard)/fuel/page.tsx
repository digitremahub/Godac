import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { PageHeader, Card } from "@/components/ui";
import { FuelHistoryTable } from "@/components/fuel/FuelHistoryTable";
import { FuelHistoryFilters } from "@/components/fuel/FuelHistoryFilters";

export default async function FuelHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string; driver?: string; status?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const canSeeOtherDrivers = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction", "comptable"]);

  let query = supabase
    .from("fuel_entries")
    .select(
      "id, occurred_at, liters, unit_price, total_amount, status, gap_flagged, station_name, vehicles(registration), users!fuel_entries_driver_id_fkey(full_name), tanks(name)",
    )
    .order("occurred_at", { ascending: false })
    .limit(50);

  if (params.vehicle) query = query.eq("vehicle_id", params.vehicle);
  if (params.driver) query = query.eq("driver_id", params.driver);
  if (params.status) query = query.eq("status", params.status);

  const [{ data: entries, error }, { data: vehicles }, { data: drivers }] = await Promise.all([
    query,
    supabase.from("vehicles").select("id, registration").order("registration"),
    canSeeOtherDrivers ? supabase.from("users").select("id, full_name").eq("active", true).order("full_name") : Promise.resolve({ data: null }),
  ]);

  return (
    <div>
      <PageHeader
        title="Historique carburant"
        description="Tous les ravitaillements — filtrez par véhicule ou par chauffeur pour voir qui a eu quoi, quand."
        actions={
          <Link href="/fuel/new" className="btn-primary">
            + Nouveau ravitaillement
          </Link>
        }
      />

      <FuelHistoryFilters
        vehicles={(vehicles ?? []).map((v) => ({ id: v.id, label: v.registration }))}
        drivers={canSeeOtherDrivers ? (drivers ?? []).map((d) => ({ id: d.id, label: d.full_name })) : null}
      />

      {error && <Card className="mb-4 text-orange-ink">{error.message}</Card>}

      <FuelHistoryTable entries={(entries ?? []) as any} />
    </div>
  );
}
