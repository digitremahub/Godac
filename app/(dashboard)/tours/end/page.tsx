import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { EndTourFlow } from "@/components/tours/EndTourFlow";

export default async function EndTourPage({
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
        title="Terminer une tournée"
        description="Scannez le même véhicule, indiquez le kilométrage retour et l'état du véhicule, puis validez votre retour."
      />
      <div className="mx-auto max-w-md">
        <EndTourFlow initialVehicleId={vehicle} requireOdometerPhoto={organization?.require_odometer_photo ?? false} />
      </div>
    </div>
  );
}
