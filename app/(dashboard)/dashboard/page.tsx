import { garderPage } from "@/lib/acces/garde-page";
import { ChauffeurDashboard } from "@/components/dashboard/ChauffeurDashboard";
import { ManagerDashboard } from "@/components/dashboard/ManagerDashboard";
import { ChefEquipeDashboard } from "@/components/dashboard/ChefEquipeDashboard";
import { ComptableDashboard } from "@/components/dashboard/ComptableDashboard";
import { DirectionDashboard } from "@/components/dashboard/DirectionDashboard";
import { PremiersPas } from "@/components/dashboard/PremiersPas";
import { RaccourcisJournee } from "@/components/dashboard/RaccourcisJournee";
import { clePremiersPas, premiersPas } from "@/lib/guides/premiers-pas";

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

  // Raccourcis de la journée (encadrement) et ligne « Premiers pas » : chaque accueil les place après son titre
  // (et après son bloc « À traiter » s'il en a un), jamais avant.
  const suite = (
    <>
      <PremiersPas pas={premiersPas(appUser.role, appUser.conduit, g.modules)} cle={clePremiersPas(appUser.role)} />
      <RaccourcisJournee role={appUser.role} modules={g.modules} conduit={appUser.conduit} />
    </>
  );
  const accueil = (() => {
    switch (appUser.role) {
      case "chauffeur":
        return <ChauffeurDashboard appUser={appUser} enabledModules={enabledModules} suite={suite} presenceMonth={searchParams.presence} />;
      case "manager":
        // Chef d'équipe : son équipe, ses véhicules, amendes et contestations, notifications.
        return <ChefEquipeDashboard appUser={appUser} enabledModules={enabledModules} suite={suite} />;
      case "exploitation":
        // Exploitation : le tableau de bord du manager, sur toute l'organisation.
        return <ManagerDashboard appUser={appUser} enabledModules={enabledModules} suite={suite} />;
      case "comptable":
        return <ComptableDashboard appUser={appUser} enabledModules={enabledModules} suite={suite} />;
      case "direction":
        return (
          <DirectionDashboard appUser={appUser} enabledModules={enabledModules} suite={suite} />
        );
    }
  })();
  return accueil;
}
