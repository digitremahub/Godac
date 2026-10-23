import { garderPage } from "@/lib/acces/garde-page";
import { ChauffeurDashboard } from "@/components/dashboard/ChauffeurDashboard";
import { ManagerDashboard } from "@/components/dashboard/ManagerDashboard";
import { ChefEquipeDashboard } from "@/components/dashboard/ChefEquipeDashboard";
import { ComptableDashboard } from "@/components/dashboard/ComptableDashboard";
import { DirectionDashboard } from "@/components/dashboard/DirectionDashboard";
import { JaugesQuotas } from "@/components/acces/JaugesQuotas";
import { USAGE_FEATURES } from "@/lib/usage/quotas";

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
  // Modules actifs de la garde (déjà chargés pour la requête) : les tuiles
  // ne montrent que les écrans qui s'ouvrent.
  const enabledModules = [...g.modules];

  switch (appUser.role) {
    case "chauffeur":
      return <ChauffeurDashboard appUser={appUser} enabledModules={enabledModules} presenceMonth={searchParams.presence} />;
    case "manager":
      // Chef d'équipe : son équipe, ses véhicules, amendes et contestations, notifications.
      return <ChefEquipeDashboard appUser={appUser} enabledModules={enabledModules} />;
    case "exploitation":
      // Exploitation : le tableau de bord du manager, sur toute l'organisation.
      return <ManagerDashboard appUser={appUser} enabledModules={enabledModules} />;
    case "comptable":
      return <ComptableDashboard appUser={appUser} enabledModules={enabledModules} />;
    case "direction":
      return (
        <>
          {/* Quotas d'IA : seulement ceux qui dépassent 80 % du volume inclus. */}
          <JaugesQuotas organizationId={appUser.organization_id} role={appUser.role} fonctions={USAGE_FEATURES} seuil={80} />
          <DirectionDashboard appUser={appUser} enabledModules={enabledModules} />
        </>
      );
  }
}
