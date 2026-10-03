import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { StartTourFlow } from "@/components/tours/StartTourFlow";

export default async function StartTourPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string }>;
}) {
  const appUser = await requireAppUser();
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
        title="Démarrer une tournée"
        description="Scannez le véhicule, indiquez le kilométrage et l'état du véhicule, puis validez votre départ."
      />
      <div className="mx-auto max-w-md">
        <StartTourFlow initialVehicleId={vehicle} requireOdometerPhoto={organization?.require_odometer_photo ?? false} />
      </div>
    </div>
  );
}
