import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { NewVehicleForm } from "@/components/vehicles/NewVehicleForm";

export default async function NewVehiclePage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const fleetEnabled = await isModuleEnabled(supabase, appUser.organization_id, "fleet");
  if (!fleetEnabled) {
    return <EmptyState title="Module Flotte non activé" description="Activez-le depuis les paramètres de votre organisation." />;
  }

  const { data: services } = await supabase.from("services").select("id, name").order("name");

  return (
    <div>
      <PageHeader title="Ajouter un véhicule" />
      <NewVehicleForm services={services ?? []} />
    </div>
  );
}
