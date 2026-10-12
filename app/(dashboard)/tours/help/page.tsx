import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { HelpColleagueFlow } from "@/components/tours/HelpColleagueFlow";

const HELPER_ROLES = ["chauffeur", "manager_chauffeur", "manager", "direction"];

export default async function HelpColleaguePage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string }>;
}) {
  const appUser = await requireAppUser();
  if (!HELPER_ROLES.includes(appUser.role)) redirect("/dashboard");
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
        title="Dépanner un collègue"
        description="Téléphone oublié ou déchargé : enregistrez son départ ou son retour à sa place, avec son badge et son code PIN."
      />
      <div className="mx-auto max-w-md">
        <HelpColleagueFlow initialVehicleId={vehicle} requireOdometerPhoto={organization?.require_odometer_photo ?? false} />
      </div>
    </div>
  );
}
