import { Suspense } from "react";
import { ATraiterAttente, ATraiterBloc } from "@/components/dashboard/ATraiterBloc";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ClassementConsommation, NotificationsOuvertes, Squelette, TourneesPlanningEnCours } from "@/components/dashboard/BlocsAccueil";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { TourHeroCard } from "@/components/dashboard/TourHeroCard";
import { AssistedClock } from "@/components/time-clock/AssistedClock";
import type { AppUser } from "@/lib/auth/session";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";

/**
 * Accueil de l'exploitation (toute l'organisation) : « À traiter
 * aujourd'hui » est le seul bloc de décision (écarts carburant, tickets à
 * vérifier, inscriptions, congés, entretien, retards… : plus de tuiles qui
 * les recomptent), puis les tournées en cours et le classement de
 * consommation. Le chef d'équipe (manager) a ChefEquipeDashboard. Une
 * personne qui conduit aussi (users.can_drive) a en plus l'action
 * départ / retour de tournée. Chaque bloc lourd est derrière un <Suspense>
 * (BlocsAccueil.tsx) ; le planning du jour est lu une seule fois pour la
 * page (« À traiter » et liste des tournées).
 */
export async function ManagerDashboard({ appUser, enabledModules, suite }: { appUser: AppUser; enabledModules: string[]; /** Raccourcis et « Premiers pas » (page.tsx), placés après le titre et le bloc « À traiter ». */ suite?: React.ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const isManagerChauffeur = appUser.conduit;
  const ctx = { role: appUser.role, modules: new Set(enabledModules), conduit: appUser.conduit };
  // Carte « Départ / Retour » : seulement si l'écran s'ouvre (module Planning).
  const tourneeOuvrable = isManagerChauffeur && ecranOuvrable("moi.tournee_depart", ctx);

  const [openTourRes, autoClockEnabled] = await Promise.all([
    isManagerChauffeur
      ? supabase.from("planning_entries").select("id, tour_number, start_at, vehicles(registration)").eq("driver_id", appUser.id).eq("status", "in_progress").maybeSingle()
      : Promise.resolve({ data: null }),
    // Pointage assisté : seulement pour une personne qui conduit aussi.
    isManagerChauffeur && enabledModules.includes("time_clock")
      ? supabase
          .from("organizations")
          .select("auto_clock_enabled")
          .eq("id", appUser.organization_id)
          .single()
          .then((r) => Boolean(r.data?.auto_clock_enabled))
      : Promise.resolve(false),
  ]);
  const openTour = openTourRes.data as { id: string; tour_number: string; start_at: string; vehicles: { registration: string } | null } | null;

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Vue d'ensemble de toute l'entreprise." />
      {autoClockEnabled && <AssistedClock hasOpenTour={Boolean(openTour)} />}

      {/* Une seule liste de tout ce qui attend une décision, triée par urgence (page dédiée : actions groupées). */}
      <Suspense fallback={<ATraiterAttente />}>
        <ATraiterBloc appUser={appUser} enabledModules={enabledModules} />
      </Suspense>
      {suite}

      {isManagerChauffeur && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tourneeOuvrable && <TourHeroCard openTour={openTour} />}
          <QrCodeBadge type="driver" id={appUser.id} title={appUser.full_name} subtitle="Mon badge chauffeur — à présenter à la pompe" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Suspense fallback={<Squelette titre="tournées en cours" />}>
          <TourneesPlanningEnCours appUser={appUser} />
        </Suspense>
        <Suspense fallback={<Squelette titre="consommation" />}>
          <ClassementConsommation />
        </Suspense>
      </div>

      <div className="mt-6">
        <Suspense fallback={null}>
          <NotificationsOuvertes appUser={appUser} enabledModules={enabledModules} masquerSiVide />
        </Suspense>
      </div>
    </div>
  );
}
