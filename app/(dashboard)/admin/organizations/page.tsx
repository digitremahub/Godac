import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader } from "@/components/ui";
import { OrganizationSettingsForm } from "@/components/admin/OrganizationSettingsForm";

export default async function OrganizationSettingsPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const [{ data: organization }, ocrEnabled] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", appUser.organization_id).single(),
    isModuleEnabled(supabase, appUser.organization_id, "ocr"),
  ]);

  return (
    <div>
      <PageHeader title="Organisation" description="Paramètres généraux de votre espace GODAC." />
      <OrganizationSettingsForm name={organization?.name ?? ""} ocrEnabled={ocrEnabled} />
    </div>
  );
}
