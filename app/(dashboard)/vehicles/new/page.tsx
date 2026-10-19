import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { NewVehicleForm } from "@/components/vehicles/NewVehicleForm";

export default async function NewVehiclePage() {
  const g = await garderPage("flotte.vehicule_nouveau");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();


  const { data: services } = await supabase.from("services").select("id, name").order("name");

  return (
    <div>
      <PageHeader title="Ajouter un véhicule" />
      <NewVehicleForm services={services ?? []} />
    </div>
  );
}
