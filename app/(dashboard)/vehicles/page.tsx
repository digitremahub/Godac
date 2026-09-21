import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { RoleGate } from "@/components/layout/RoleGate";
import { VehicleImportPanel } from "@/components/vehicles/VehicleImportPanel";

const STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  maintenance: "Entretien",
  out_of_service: "Hors service",
};

export default async function VehiclesPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const fleetEnabled = await isModuleEnabled(supabase, appUser.organization_id, "fleet");
  if (!fleetEnabled) {
    return (
      <EmptyState
        title="Module Flotte non activé"
        description="Activez-le depuis les paramètres de votre organisation pour gérer vos véhicules."
      />
    );
  }

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
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-navy/40">
              <tr>
                <th className="pb-2">Immatriculation</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Service</th>
                <th className="pb-2">Capacité réservoir</th>
                <th className="pb-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v: any) => (
                <tr key={v.id} className="border-t border-navy/5">
                  <td className="py-2">
                    <Link href={`/vehicles/${v.id}`} className="text-teal-ink hover:underline">
                      {v.registration}
                    </Link>
                  </td>
                  <td className="py-2">{v.type}</td>
                  <td className="py-2">{v.services?.name ?? "—"}</td>
                  <td className="py-2">{v.tank_capacity_liters ? `${v.tank_capacity_liters} L` : "—"}</td>
                  <td className="py-2">
                    <span className={v.status === "active" ? "badge-teal" : v.status === "maintenance" ? "badge-gold" : "badge-orange"}>
                      {STATUS_LABELS[v.status] ?? v.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
