import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { InterventionsPanel } from "@/components/vehicles/InterventionsPanel";
import { VehicleEditPanel } from "@/components/vehicles/VehicleEditPanel";
import { RoleGate } from "@/components/layout/RoleGate";

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const fleetEnabled = await isModuleEnabled(supabase, appUser.organization_id, "fleet");
  if (!fleetEnabled) {
    return <EmptyState title="Module Flotte non activé" description="Activez-le depuis les paramètres de votre organisation." />;
  }

  const [{ data: vehicle }, { data: interventions }, { data: services }] = await Promise.all([
    supabase.from("vehicles").select("id, registration, type, status, tank_capacity_liters, service_id, services(name)").eq("id", id).single(),
    supabase
      .from("vehicle_interventions")
      .select("id, type, description, urgency, status, scheduled_at, completed_at, cost")
      .eq("vehicle_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("services").select("id, name").order("name"),
  ]);

  if (!vehicle) notFound();
  const v = vehicle as any;

  return (
    <div>
      <PageHeader
        title={v.registration}
        description={`${v.type} · ${v.services?.name ?? "Sans service"}`}
        actions={
          <RoleGate role={appUser.role} allow={["manager", "manager_chauffeur", "direction"]}>
            <VehicleEditPanel
              vehicleId={v.id}
              registration={v.registration}
              type={v.type}
              tankCapacity={v.tank_capacity_liters}
              status={v.status}
              serviceId={v.service_id}
              services={services ?? []}
            />
          </RoleGate>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <InterventionsPanel
            vehicleId={id}
            interventions={interventions ?? []}
            canManage={hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])}
          />
        </div>
        <div className="flex flex-col items-center gap-4">
          <Card>
            <p className="text-sm text-navy/50">Capacité réservoir</p>
            <p className="text-xl">{v.tank_capacity_liters ? `${v.tank_capacity_liters} L` : "Non renseignée"}</p>
          </Card>
          <QrCodeBadge
            type="vehicle"
            id={v.id}
            title={v.registration}
            subtitle="À coller sur le tableau de bord"
          />
        </div>
      </div>
    </div>
  );
}
