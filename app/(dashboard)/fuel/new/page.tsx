import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { NewFuelEntryWizard } from "@/components/fuel/NewFuelEntryWizard";

export default async function NewFuelEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string; tank?: string }>;
}) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const params = await searchParams;

  const [{ data: vehicles }, { data: tanks }, { data: organization }] = await Promise.all([
    supabase.from("vehicles").select("id, registration, type").eq("status", "active").order("registration"),
    supabase.from("tanks").select("id, name, fuel_type").order("name"),
    supabase.from("organizations").select("ocr_enabled").eq("id", appUser.organization_id).single(),
  ]);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Nouveau ravitaillement"
        description="Scannez véhicule + cuve, ou sélectionnez-les manuellement."
      />
      <NewFuelEntryWizard
        vehicles={vehicles ?? []}
        tanks={tanks ?? []}
        ocrEnabled={organization?.ocr_enabled ?? false}
        initialVehicleId={params.vehicle}
        initialTankId={params.tank}
        selfDriverId={appUser.id}
        selfDriverName={appUser.full_name}
      />
    </div>
  );
}
