import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import Link from "next/link";
import { InterventionsPanel } from "@/components/vehicles/InterventionsPanel";
import { VehicleEditPanel } from "@/components/vehicles/VehicleEditPanel";
import { RoleGate } from "@/components/layout/RoleGate";
import { FuelHistoryTable } from "@/components/fuel/FuelHistoryTable";
import { OdometerHistory, type OdometerReading } from "@/components/vehicles/OdometerHistory";
import { WashHistory, type WashRecord } from "@/components/vehicles/WashHistory";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const [fleetEnabled, washesEnabled] = await Promise.all([
    isModuleEnabled(supabase, appUser.organization_id, "fleet"),
    isModuleEnabled(supabase, appUser.organization_id, "washes"),
  ]);
  if (!fleetEnabled) {
    return <EmptyState title="Module Flotte non activé" description="Activez-le depuis les paramètres de votre organisation." />;
  }

  const [
    { data: vehicle },
    { data: interventions },
    { data: services },
    { data: fuelHistory },
    { data: tours },
    { data: washes },
    consumption30d,
    consumption90d,
  ] = await Promise.all([
      supabase
        .from("vehicles")
        .select("id, registration, type, status, tank_capacity_liters, initial_km, created_at, service_id, services(name)")
        .eq("id", id)
        .single(),
      supabase
        .from("vehicle_interventions")
        .select(
          "id, type, description, urgency, status, scheduled_at, completed_at, cost, odometer_km, appointment_needed, photo_paths, created_at",
        )
        .eq("vehicle_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("services").select("id, name").order("name"),
      supabase
        .from("fuel_entries")
        .select("id, occurred_at, liters, total_amount, status, gap_flagged, users!fuel_entries_driver_id_fkey(full_name)")
        .eq("vehicle_id", id)
        .order("occurred_at", { ascending: false })
        .limit(15),
      supabase
        .from("planning_entries")
        .select("id, tour_number, start_at, end_at, start_km, end_km")
        .eq("vehicle_id", id)
        .order("start_at", { ascending: false })
        .limit(20),
      washesEnabled
        ? supabase
            .from("vehicle_washes")
            .select("id, created_at, washed_exterior, washed_cabin_interior, washed_trailer, users(full_name)")
            .eq("vehicle_id", id)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: null }),
      getVehicleConsumption(supabase, id, 30),
      getVehicleConsumption(supabase, id, 90),
    ]);

  if (!vehicle) notFound();
  const v = vehicle as any;

  const interventionsWithPhotos = await Promise.all(
    (interventions ?? []).map(async (i: any) => {
      const paths: string[] = i.photo_paths ?? [];
      const photoUrls = await Promise.all(
        paths.map(async (path) => {
          const { data } = await supabase.storage.from("intervention-photos").createSignedUrl(path, 600);
          return data?.signedUrl ?? null;
        }),
      );
      return { ...i, photoUrls: photoUrls.filter((u): u is string => Boolean(u)) };
    }),
  );

  const odometerReadings: OdometerReading[] = [
    ...(v.initial_km !== null ? [{ at: v.created_at, km: v.initial_km, label: "Kilométrage initial" }] : []),
    ...(tours ?? []).flatMap((t: any) => [
      ...(t.start_km !== null ? [{ at: t.start_at, km: t.start_km, label: `Départ tournée n°${t.tour_number}` }] : []),
      ...(t.end_km !== null && t.end_at ? [{ at: t.end_at, km: t.end_km, label: `Retour tournée n°${t.tour_number}` }] : []),
    ]),
    ...(interventions ?? [])
      .filter((i: any) => i.odometer_km !== null)
      .map((i: any) => ({ at: i.created_at, km: i.odometer_km, label: `Intervention : ${i.type}` })),
  ];

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
              initialKm={v.initial_km}
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
            interventions={interventionsWithPhotos}
            canManage={hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])}
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-base">Historique des chauffeurs</h3>
              <Link href={`/fuel?vehicle=${id}`} className="text-sm text-teal-ink hover:underline">
                Voir tout l&apos;historique →
              </Link>
            </div>
            <FuelHistoryTable
              entries={(fuelHistory ?? []) as any}
              showVehicle={false}
              emptyDescription="Aucun ravitaillement enregistré pour ce véhicule."
            />
          </div>

          {washesEnabled && (
            <WashHistory
              washes={(washes ?? []).map((w: any) => ({
                id: w.id,
                created_at: w.created_at,
                washed_exterior: w.washed_exterior,
                washed_cabin_interior: w.washed_cabin_interior,
                washed_trailer: w.washed_trailer,
                driverName: w.users?.full_name ?? "—",
              })) as WashRecord[]}
            />
          )}
        </div>
        <div className="flex flex-col items-center gap-4">
          <Card>
            <p className="text-sm text-navy/50">Capacité réservoir</p>
            <p className="text-xl">{v.tank_capacity_liters ? `${v.tank_capacity_liters} L` : "Non renseignée"}</p>
          </Card>
          <Card className="w-full">
            <p className="mb-2 text-sm text-navy/50">Consommation moyenne</p>
            <div className="flex justify-around text-center">
              <div>
                <p className="text-xl">{consumption30d !== null ? `${consumption30d} L/100km` : "—"}</p>
                <p className="text-xs text-navy/40">30 derniers jours</p>
              </div>
              <div>
                <p className="text-xl">{consumption90d !== null ? `${consumption90d} L/100km` : "—"}</p>
                <p className="text-xs text-navy/40">90 derniers jours</p>
              </div>
            </div>
            {consumption30d === null && consumption90d === null && (
              <p className="mt-2 text-xs text-navy/40">Pas assez de relevés kilométriques pour calculer la consommation.</p>
            )}
          </Card>
          <div className="w-full">
            <OdometerHistory readings={odometerReadings} />
          </div>
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
