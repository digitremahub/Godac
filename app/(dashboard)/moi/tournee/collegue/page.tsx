import { garderPage } from "@/lib/acces/garde-page";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { HelpColleagueFlow } from "@/components/tours/HelpColleagueFlow";
import { isModuleEnabled } from "@/lib/organization/modules";

const HELPER_ROLES = ["chauffeur", "manager", "exploitation", "direction"];

export default async function HelpColleaguePage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string }>;
}) {
  const g = await garderPage("moi.tournee_collegue");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  if (!HELPER_ROLES.includes(appUser.role)) redirect("/dashboard");
  const supabase = await createServerSupabaseClient();
  const { vehicle } = await searchParams;
  const [{ data: organization }, { data: vehicles }, { data: tanks }, planningEnabled] = await Promise.all([
    supabase.from("organizations").select("require_odometer_photo").eq("id", appUser.organization_id).single(),
    supabase.from("vehicles").select("id, registration, type").eq("status", "active").order("registration"),
    supabase.from("tanks").select("id, name, fuel_type").order("name"),
    isModuleEnabled(supabase, appUser.organization_id, "planning"),
  ]);

  return (
    <div>
      <PageHeader
        title="J'entre le départ / retour / plein d'un collègue"
        description="Téléphone oublié ou déchargé : saisissez à sa place, avec son badge et son code PIN. Tout est enregistré à son nom."
      />
      <div className="mx-auto max-w-md">
        <HelpColleagueFlow
          initialVehicleId={vehicle}
          requireOdometerPhoto={organization?.require_odometer_photo ?? false}
          planningEnabled={planningEnabled}
          vehicles={vehicles ?? []}
          tanks={tanks ?? []}
        />
      </div>
    </div>
  );
}
