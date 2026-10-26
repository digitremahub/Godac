import { Suspense } from "react";
import { ATraiterAttente, ATraiterBloc } from "@/components/dashboard/ATraiterBloc";
import { ClassementConsommation, IndicateursDirection, NotificationsOuvertes, ReportingDirection, Squelette, SqueletteTuiles, TourneesColisEnCours } from "@/components/dashboard/BlocsAccueil";
import { PageHeader } from "@/components/ui";
import type { AppUser } from "@/lib/auth/session";

/**
 * Accueil de la direction, toute l'organisation, dans l'ordre :
 * 1. « À traiter aujourd'hui » : le seul bloc de décision (écarts
 *    carburant, tickets, bulletins de paie, inscriptions, congés,
 *    entretien, retards…), plus de tuiles qui recomptent la même chose ;
 * 2. les indicateurs (coût carburant du mois en premier) ;
 * 3. les tournées colis en cours, le reporting, la consommation et les
 *    notifications ouvertes.
 * Chaque bloc lourd se charge derrière son <Suspense> (BlocsAccueil.tsx) ;
 * les agrégats viennent de la base (migration 20261106000003, repli sur
 * l'ancien calcul sans elle). Les codes de secours des chauffeurs sont dans
 * Équipe › Utilisateurs.
 */
export function DirectionDashboard({ appUser, enabledModules }: { appUser: AppUser; enabledModules: string[] }) {
  const biEnabled = enabledModules.includes("bi_reporting");
  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Vue d'ensemble de l'organisation." />

      {/* Une seule liste de tout ce qui attend une décision, triée par urgence (page dédiée : actions groupées). */}
      <Suspense fallback={<ATraiterAttente />}>
        <ATraiterBloc appUser={appUser} enabledModules={enabledModules} />
      </Suspense>

      <Suspense fallback={<SqueletteTuiles />}>
        <IndicateursDirection appUser={appUser} enabledModules={enabledModules} />
      </Suspense>

      <Suspense fallback={<Squelette titre="tournées colis en cours" />}>
        <TourneesColisEnCours appUser={appUser} enabledModules={enabledModules} />
      </Suspense>

      {biEnabled && (
        <Suspense fallback={<Squelette titre="reporting" lignes={4} />}>
          <ReportingDirection appUser={appUser} />
        </Suspense>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Suspense fallback={<Squelette titre="consommation" />}>
          <ClassementConsommation className="lg:col-span-2" />
        </Suspense>
        <Suspense fallback={<Squelette titre="notifications" />}>
          <NotificationsOuvertes appUser={appUser} enabledModules={enabledModules} />
        </Suspense>
      </div>
    </div>
  );
}
