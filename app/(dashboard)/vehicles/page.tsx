import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { RoleGate } from "@/components/layout/RoleGate";
import { VehicleImportPanel } from "@/components/vehicles/VehicleImportPanel";
import { VehicleFleetTable } from "@/components/vehicles/VehicleFleetTable";

export default async function VehiclesPage() {
  const g = await garderPage("flotte.vehicules");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();


  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, registration, type, status, tank_capacity_liters, services(name)")
    .order("registration");

  return (
    <div>
      <PageHeader
        title="Flotte"
        description="Véhicules légers et poids lourds de votre organisation."
        actions={
          <RoleGate role={appUser.role} allow={["manager", "manager_chauffeur", "direction"]}>
            <Link href="/vehicles/new" className="btn-primary">
              + Ajouter un véhicule
            </Link>
          </RoleGate>
        }
      />

      <RoleGate role={appUser.role} allow={["direction"]}>
        <div className="mb-4">
          <VehicleImportPanel />
        </div>
      </RoleGate>

      {!vehicles || vehicles.length === 0 ? (
        <EmptyState title="Aucun véhicule" description="Importez votre flotte depuis un fichier ou ajoutez un véhicule." />
      ) : (
        <VehicleFleetTable vehicles={vehicles as any} />
      )}
    </div>
  );
}
