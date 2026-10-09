import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { tryAutoProvisionInvitedUser } from "@/lib/auth/provisioning";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getEnabledModuleKeys } from "@/lib/organization/modules";
import { DashboardShell } from "@/components/layout/DashboardShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let appUser = await getCurrentAppUser();

  if (!appUser) {
    // An invited user's first visit after clicking their email link
    // finishes silently here; an organic sign-up gets sent to
    // onboarding to create their own organisation.
    appUser = await tryAutoProvisionInvitedUser();
  }

  if (!appUser) {
    redirect("/onboarding");
  }

  const supabase = await createServerSupabaseClient();
  const isFieldRole = appUser.role === "chauffeur" || appUser.role === "manager_chauffeur";
  const [enabledModuleKeys, { data: organization }, activeTour] = await Promise.all([
    getEnabledModuleKeys(supabase, appUser.organization_id),
    supabase.from("organizations").select("name, logo_url, accent_color").eq("id", appUser.organization_id).single(),
    isFieldRole
      ? supabase.from("planning_entries").select("id").eq("driver_id", appUser.id).eq("status", "in_progress").maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Lot B: absent (not just visually hidden) the moment either the
  // org hasn't enabled the module or the server has no Anthropic key
  // configured — never a client-side check, so there's no flash of a
  // button that would then fail on first use.
  const assistantAvailable = enabledModuleKeys.includes("assistant") && Boolean(process.env.ANTHROPIC_API_KEY);
  const messengerAvailable = enabledModuleKeys.includes("messenger");

  return (
    <DashboardShell
      role={appUser.role}
      enabledModuleKeys={enabledModuleKeys}
      organizationName={organization?.name ?? "GODAC"}
      logoUrl={organization?.logo_url ?? null}
      accentColor={organization?.accent_color ?? null}
      fullName={appUser.full_name}
      roleTitle={appUser.role_title}
      hasActiveTour={Boolean(activeTour.data)}
      assistantAvailable={assistantAvailable}
      messengerAvailable={messengerAvailable}
      currentUserId={appUser.id}
      organizationId={appUser.organization_id}
    >
      {children}
    </DashboardShell>
  );
}
