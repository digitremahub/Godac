import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { InterventionsPanel } from "@/components/vehicles/InterventionsPanel";

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const [{ data: vehicle }, { data: interventions }] = await Promise.all([
    supabase.from("vehicles").select("id, registration, type, status, tank_capacity_liters, services(name)").eq("id", id).single(),
    supabase
      .from("vehicle_interventions")
      .select("id, type, description, status, scheduled_at, completed_at, cost")
      .eq("vehicle_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!vehicle) notFound();
  const v = vehicle as any;

  return (
    <div>
      <PageHeader title={v.registration} description={`${v.type} · ${v.services?.name ?? "Sans service"}`} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <InterventionsPanel vehicleId={id} interventions={interventions ?? []} />
        </div>
        <div className="flex flex-col items-center gap-4">
          <Card>
            <p className="text-sm text-white/50">Capacité réservoir</p>
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
