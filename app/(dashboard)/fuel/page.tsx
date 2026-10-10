import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card } from "@/components/ui";
import { FuelHistoryTable } from "@/components/fuel/FuelHistoryTable";
import { FuelHistoryFilters } from "@/components/fuel/FuelHistoryFilters";
import { NewFuelEntryWizard } from "@/components/fuel/NewFuelEntryWizard";

/**
 * "Carburant" (historique) et "Nouveau ravitaillement" (l'assistant de
 * plein) réunis sur une seule route — ex-/fuel/new. `?new=1` est le
 * seul interrupteur qui bascule vers l'assistant : vehicle/driver sont
 * déjà réutilisés par les filtres d'historique ci-dessous, donc ça ne
 * peut pas être leur simple présence qui décide (un lien "⛽ Plein"
 * depuis une fiche véhicule, un scan QR cuve/badge chauffeur, ou le
 * bouton "Plein" de la barre mobile chauffeur passent désormais tous
 * ?new=1 en plus de leurs propres paramètres).
 */
export default async function FuelPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string; driver?: string; status?: string; tank?: string; new?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const wizardMode = Boolean(params.new);

  if (wizardMode) {
    const [{ data: vehicles }, { data: tanks }, ocrEnabled, { data: assignedVehicle }, { data: driver }] = await Promise.all([
      supabase.from("vehicles").select("id, registration, type").eq("status", "active").order("registration"),
      supabase.from("tanks").select("id, name, fuel_type").order("name"),
      isModuleEnabled(supabase, appUser.organization_id, "ocr"),
      supabase.from("vehicles").select("id").eq("assigned_driver_id", appUser.id).eq("status", "active").maybeSingle(),
      params.driver ? supabase.from("users").select("full_name").eq("id", params.driver).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    return (
      <div className="mx-auto max-w-lg">
        <PageHeader
          title="Nouveau ravitaillement"
          description="Scannez véhicule + cuve, ou sélectionnez-les manuellement."
          actions={
            <Link href="/fuel" className="btn-secondary">
              ← Historique
            </Link>
          }
        />
        <NewFuelEntryWizard
          vehicles={vehicles ?? []}
          tanks={tanks ?? []}
          ocrEnabled={ocrEnabled}
          initialVehicleId={params.vehicle}
          initialTankId={params.tank}
          initialDriverId={params.driver}
          initialDriverName={driver?.full_name}
          assignedVehicleId={assignedVehicle?.id}
          selfDriverId={appUser.id}
          selfDriverName={appUser.full_name}
        />
      </div>
    );
  }

  const canSeeOtherDrivers = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction", "comptable"]);
  const canCreate = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);

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
          canCreate ? (
            <Link href="/fuel?new=1" className="btn-primary">
              + Nouveau ravitaillement
            </Link>
          ) : undefined
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
