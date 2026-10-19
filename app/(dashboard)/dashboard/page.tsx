import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getEnabledModuleKeys } from "@/lib/organization/modules";
import { ChauffeurDashboard } from "@/components/dashboard/ChauffeurDashboard";
import { ManagerDashboard } from "@/components/dashboard/ManagerDashboard";
import { ComptableDashboard } from "@/components/dashboard/ComptableDashboard";
import { DirectionDashboard } from "@/components/dashboard/DirectionDashboard";

/**
 * The one page every role lands on after sign-in (see middleware.ts).
 * Each role gets its own tailored view — what's worth seeing at a
 * glance is completely different for a driver than for direction —
 * so this just reads the shared context once and delegates.
 */
export default async function DashboardPage({ searchParams }: { searchParams: { presence?: string } }) {
  const g = await garderPage("dashboard.accueil");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const enabledModules = await getEnabledModuleKeys(supabase, appUser.organization_id);

  switch (appUser.role) {
    case "chauffeur":
      return <ChauffeurDashboard appUser={appUser} enabledModules={enabledModules} presenceMonth={searchParams.presence} />;
    case "manager":
    case "manager_chauffeur":
      return <ManagerDashboard appUser={appUser} enabledModules={enabledModules} />;
    case "comptable":
      return <ComptableDashboard appUser={appUser} enabledModules={enabledModules} />;
    case "direction":
      return <DirectionDashboard appUser={appUser} enabledModules={enabledModules} />;
  }
}
