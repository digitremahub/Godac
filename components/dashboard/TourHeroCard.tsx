import Link from "next/link";
import { IconArrowRight, IconFlag, IconTruck } from "@/components/layout/icons";

/**
 * The one action a driver opens the app for: start or end today's
 * tour. Navy hero so it reads first on a phone, before the stats.
 */
export function TourHeroCard({
  openTour,
  showPlanningLink,
}: {
  openTour: { tour_number: string; start_at?: string; vehicles: { registration: string } | null } | null;
  showPlanningLink?: boolean;
}) {
  const startedAt = openTour?.start_at
    ? new Date(openTour.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-2xl bg-navy p-6 text-white shadow-raised">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-teal/20 blur-3xl"
      />
      <div className="relative flex items-start gap-4">
        <span
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${openTour ? "bg-teal text-navy" : "bg-white/10 text-teal"}`}
        >
          {openTour ? <IconTruck className="h-6 w-6" /> : <IconFlag className="h-6 w-6" />}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
            {openTour ? "Tournée en cours" : "Aujourd’hui"}
          </p>
          <p className="mt-1 font-display text-xl font-bold leading-tight">
            {openTour ? `Tournée n°${openTour.tour_number}` : "Aucune tournée en cours"}
          </p>
          {openTour && (
            <p className="mt-1 text-sm text-white/70">
              {openTour.vehicles ? openTour.vehicles.registration : "Véhicule non renseigné"}
              {startedAt ? ` · départ à ${startedAt}` : ""}
            </p>
          )}
        </div>
      </div>

      <div className="relative flex flex-col gap-3">
        <Link href={openTour ? "/tours/end" : "/tours/start"} className="btn-primary w-full !py-3.5 text-base">
          {openTour ? "Terminer ma tournée" : "Démarrer une tournée"}
          <IconArrowRight className="h-5 w-5" />
        </Link>
        {showPlanningLink && (
          <Link href="/planning/mine" className="text-center text-sm font-medium text-white/75 hover:text-white">
            Voir mon planning
          </Link>
        )}
      </div>
    </div>
  );
}
