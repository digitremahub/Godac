import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { JaugeQuota } from "@/components/acces/JaugeQuota";
import { limiteVehicules } from "@/lib/acces/limites-serveur";
import { PageHeader, EmptyState } from "@/components/ui";
import { VehicleImportPanel } from "@/components/vehicles/VehicleImportPanel";
import { VehicleFleetTable } from "@/components/vehicles/VehicleFleetTable";

export default async function VehiclesPage() {
  const g = await garderPage("flotte.vehicules");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const encadrement = appUser.role !== "comptable";

  const [{ data: vehicles }, limite] = await Promise.all([
    supabase.from("vehicles").select("id, registration, type, status, tank_capacity_liters, services(name)").order("registration"),
    encadrement ? limiteVehicules(appUser.organization_id) : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader
        title="Flotte"
        description="Véhicules légers et poids lourds de votre organisation."
        actions={
          encadrement ? (
            <Link href="/flotte/vehicules/nouveau" className="btn-primary">
              + Ajouter un véhicule
            </Link>
          ) : undefined
        }
      />

      {limite && limite.inclus !== null && (
        <div className="mb-4 max-w-md">
          <JaugeQuota
            libelle={`Véhicules inclus dans la formule ${limite.nomFormule ?? ""}`.trim()}
            utilise={limite.utilise}
            inclus={limite.inclus}
            direction={appUser.role === "direction"}
          />
        </div>
      )}

      {appUser.role === "direction" && (
        <div className="mb-4">
          <VehicleImportPanel />
        </div>
      )}

      {!vehicles || vehicles.length === 0 ? (
        <EmptyState title="Aucun véhicule" description="Importez votre flotte depuis un fichier ou ajoutez un véhicule." />
      ) : (
        <VehicleFleetTable vehicles={vehicles as any} />
      )}
    </div>
  );
}
