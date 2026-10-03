import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getEnabledModuleKeys } from "@/lib/organization/modules";
import { PageHeader } from "@/components/ui";
import { VehicleActionsPanel } from "@/components/vehicles/VehicleActionsPanel";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";

const STATUS_LABELS: Record<string, string> = {
  active: "En service",
  maintenance: "En entretien",
  out_of_service: "Hors service",
};

/**
 * Driver-facing landing page for the vehicle QR sticker — distinct
 * from the manager-oriented fiche at /vehicles/[id] (edit panel,
 * interventions, full history). This is what a chauffeur reaches:
 * a handful of large touch-target actions, no management controls.
 */
export default async function VehicleQuickActionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const [{ data: vehicle }, enabledModuleKeys, { data: activeTour }] = await Promise.all([
    supabase.from("vehicles").select("id, registration, type, status").eq("id", id).single(),
    getEnabledModuleKeys(supabase, appUser.organization_id),
    supabase
      .from("planning_entries")
      .select("id")
      .eq("driver_id", appUser.id)
      .eq("vehicle_id", id)
      .eq("status", "in_progress")
      .maybeSingle(),
  ]);

  if (!vehicle) notFound();
  const hasActiveTourHere = Boolean(activeTour);

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={vehicle.registration} description={`${vehicle.type} · ${STATUS_LABELS[vehicle.status] ?? vehicle.status}`} />
      <VehicleActionsPanel
        vehicleId={vehicle.id}
        vehicleType={vehicle.type}
        role={appUser.role}
        enabledModuleKeys={enabledModuleKeys}
        hasActiveTourHere={hasActiveTourHere}
      />
      {/* Only the driver currently on tour with this vehicle (not just
          anyone who scanned it) sees its badge here — matches the
          same in_progress query used for hasActiveTourHere above, so
          this can never show for a vehicle the signed-in user isn't
          actually assigned to right now. */}
      {hasActiveTourHere && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <p className="label">Badge véhicule</p>
          <QrCodeBadge type="vehicle" id={vehicle.id} title={vehicle.registration} subtitle="À coller sur le tableau de bord" />
        </div>
      )}
    </div>
  );
}
