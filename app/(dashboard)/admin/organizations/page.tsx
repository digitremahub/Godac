import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { OrganizationSettingsForm } from "@/components/admin/OrganizationSettingsForm";

export default async function OrganizationSettingsPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { data: organization } = await supabase
    .from("organizations")
    .select("name, ocr_enabled")
    .eq("id", appUser.organization_id)
    .single();

  return (
    <div>
      <PageHeader title="Organisation" description="Paramètres généraux de votre espace GODAC." />
      <OrganizationSettingsForm name={organization?.name ?? ""} ocrEnabled={organization?.ocr_enabled ?? false} />
    </div>
  );
}
