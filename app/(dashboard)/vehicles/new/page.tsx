import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { NewVehicleForm } from "@/components/vehicles/NewVehicleForm";

export default async function NewVehiclePage() {
  const supabase = createServerSupabaseClient();
  const { data: services } = await supabase.from("services").select("id, name").order("name");

  return (
    <div>
      <PageHeader title="Ajouter un véhicule" />
      <NewVehicleForm services={services ?? []} />
    </div>
  );
}
