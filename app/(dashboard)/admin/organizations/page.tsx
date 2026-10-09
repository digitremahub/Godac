import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader } from "@/components/ui";
import { OrganizationSettingsForm } from "@/components/admin/OrganizationSettingsForm";
import { ServicesPanel } from "@/components/admin/ServicesPanel";
import { TanksPanel } from "@/components/admin/TanksPanel";
import { AssistantNotesPanel } from "@/components/admin/AssistantNotesPanel";
import { JoinLinkCard } from "@/components/admin/JoinLinkCard";

export default async function OrganizationSettingsPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const [{ data: organization }, ocrEnabled, assistantEnabled, { data: services }, { data: tanks }, { data: notes }] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "name, logo_url, accent_color, require_odometer_photo, emergency_phone, consumption_anomaly_threshold_percent, driver_signup_token, depot_address, siret, legal_address",
      )
      .eq("id", appUser.organization_id)
      .single(),
    isModuleEnabled(supabase, appUser.organization_id, "ocr"),
    isModuleEnabled(supabase, appUser.organization_id, "assistant"),
    supabase.from("services").select("id, name, code").order("name"),
    supabase.from("tanks").select("id, name, fuel_type, capacity_liters, current_totalizer_index, service_id").order("name"),
    supabase.from("assistant_notes").select("id, title, content, roles").order("created_at", { ascending: false }),
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
        consumptionAnomalyThresholdPercent={organization?.consumption_anomaly_threshold_percent ?? 20}
        depotAddress={organization?.depot_address ?? null}
        siret={organization?.siret ?? null}
        legalAddress={organization?.legal_address ?? null}
      />
      <ServicesPanel services={services ?? []} />
      <TanksPanel tanks={tanks ?? []} services={services ?? []} />
      {assistantEnabled && <AssistantNotesPanel notes={(notes ?? []) as any} />}
      {appUser.role === "direction" && organization?.driver_signup_token && (
        <JoinLinkCard token={organization.driver_signup_token} />
      )}
    </div>
  );
}
