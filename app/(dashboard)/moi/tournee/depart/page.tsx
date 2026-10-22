import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { StartTourFlow } from "@/components/tours/StartTourFlow";

export default async function StartTourPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string }>;
}) {
  const g = await garderPage("moi.tournee_depart");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const { vehicle } = await searchParams;
  const { data: organization } = await supabase
    .from("organizations")
    .select("require_odometer_photo")
    .eq("id", appUser.organization_id)
    .single();

  return (
    <div>
      <PageHeader
        title="Départ"
        description="Prenez votre véhicule pour la tournée du jour : scannez-le, indiquez le kilométrage et son état, puis validez votre départ."
      />
      <div className="mx-auto max-w-md">
        <StartTourFlow initialVehicleId={vehicle} requireOdometerPhoto={organization?.require_odometer_photo ?? false} />
      </div>
    </div>
  );
}
