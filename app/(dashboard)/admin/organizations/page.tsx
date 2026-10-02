import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader } from "@/components/ui";
import { OrganizationSettingsForm } from "@/components/admin/OrganizationSettingsForm";
import { ServicesPanel } from "@/components/admin/ServicesPanel";
import { TanksPanel } from "@/components/admin/TanksPanel";

export default async function OrganizationSettingsPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const [{ data: organization }, ocrEnabled, { data: services }, { data: tanks }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, logo_url, accent_color, require_odometer_photo, emergency_phone")
      .eq("id", appUser.organization_id)
      .single(),
    isModuleEnabled(supabase, appUser.organization_id, "ocr"),
    supabase.from("services").select("id, name, code").order("name"),
    supabase.from("tanks").select("id, name, fuel_type, capacity_liters, current_totalizer_index, service_id").order("name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Organisation" description="Paramètres généraux de votre espace GODAC." />
      <OrganizationSettingsForm
        organizationId={appUser.organization_id}
        name={organization?.name ?? ""}
        ocrEnabled={ocrEnabled}
        logoUrl={organization?.logo_url ?? null}
        accentColor={organization?.accent_color ?? null}
        requireOdometerPhoto={organization?.require_odometer_photo ?? false}
        emergencyPhone={organization?.emergency_phone ?? null}
      />
      <ServicesPanel services={services ?? []} />
      <TanksPanel tanks={tanks ?? []} services={services ?? []} />
    </div>
  );
}
