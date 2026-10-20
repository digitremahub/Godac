import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { VehicleAssignmentActions } from "@/components/vehicles/VehicleAssignmentActions";

const STATUS_LABELS: Record<string, string> = {
  active: "En service",
  maintenance: "En entretien",
  out_of_service: "Hors service",
};

/**
 * A vehicle sits assigned to one driver between tours
 * (vehicles.assigned_driver_id) — distinct from the transient
 * "tournée en cours" concept. A manager assigns it from the fleet
 * fiche (/flotte/vehicules/[id]); here the driver can also self-claim any
 * vehicle that's currently unassigned, or release their own.
 */
export default async function MyVehiclePage() {
  const g = await garderPage("moi.vehicule");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;

  const supabase = await createServerSupabaseClient();

  const { data: myVehicle } = await supabase
    .from("vehicles")
    .select("id, registration, type, status, tank_capacity_liters, services(name)")
    .eq("assigned_driver_id", appUser.id)
    .maybeSingle();

  if (myVehicle) {
    const [consumption30d, consumption90d] = await Promise.all([
      getVehicleConsumption(supabase, myVehicle.id, 30),
      getVehicleConsumption(supabase, myVehicle.id, 90),
    ]);

    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <PageHeader title="Mon véhicule" description="Le véhicule qui vous est assigné." />
        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-xl">{myVehicle.registration}</p>
            <p className="text-sm text-navy/65">
              {myVehicle.type} · {STATUS_LABELS[myVehicle.status] ?? myVehicle.status} ·{" "}
              {(myVehicle as any).services?.name ?? "Sans service"}
            </p>
          </div>
          <div className="flex justify-around text-center">
            <div>
              <p className="text-lg">{myVehicle.tank_capacity_liters ? `${myVehicle.tank_capacity_liters} L` : "—"}</p>
              <p className="text-xs text-navy/60">Réservoir</p>
            </div>
            <div>
              <p className="text-lg">{consumption30d !== null ? `${consumption30d} L/100km` : "—"}</p>
              <p className="text-xs text-navy/60">30 derniers jours</p>
            </div>
            <div>
              <p className="text-lg">{consumption90d !== null ? `${consumption90d} L/100km` : "—"}</p>
              <p className="text-xs text-navy/60">90 derniers jours</p>
            </div>
          </div>
          <Link href={`/v/${myVehicle.id}`} className="btn-primary text-center">
            Voir la fiche véhicule
          </Link>
          <VehicleAssignmentActions vehicleId={myVehicle.id} claim={false} label="Libérer ce véhicule" />
        </Card>
      </div>
    );
  }

  const { data: myServices } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
  const serviceIds = (myServices ?? []).map((s) => s.service_id);

  let availableQuery = supabase
    .from("vehicles")
    .select("id, registration, type, status")
    .is("assigned_driver_id", null)
    .eq("status", "active")
    .order("registration");
  if (serviceIds.length > 0) {
    availableQuery = availableQuery.in("service_id", serviceIds);
  }
  const { data: available } = await availableQuery;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <PageHeader title="Mon véhicule" description="Aucun véhicule ne vous est assigné pour le moment." />
      {!available || available.length === 0 ? (
        <EmptyState
          title="Aucun véhicule disponible"
          description="Demandez à un responsable de vous assigner un véhicule."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {available.map((v) => (
            <Card key={v.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{v.registration}</p>
                <p className="text-xs text-navy/65">{v.type}</p>
              </div>
              <VehicleAssignmentActions vehicleId={v.id} claim={true} label="Prendre ce véhicule" />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
