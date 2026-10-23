"use client";

import { IconNavigation } from "@/components/layout/icons";

/**
 * Fin de tournée : dernier arrêt traité, on propose de lancer le retour au
 * dépôt (navigation externe vers le dépôt de la tournée) avant de clôturer.
 */
export function RetourDepot({
  depot,
  distanceKm,
  lien,
  nomNavigation,
  onPlusTard,
}: {
  depot: string;
  distanceKm: number | null;
  /** Lien de l'application de navigation choisie, vers le dépôt. */
  lien: string;
  nomNavigation: string;
  onPlusTard: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-marine/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="retour-depot-titre">
      <section className="flex w-full max-w-md flex-col gap-3 rounded-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop">
        <h2 id="retour-depot-titre" className="font-display text-xl font-bold">
          Tournée terminée 🎉
        </h2>
        <p className="text-sm text-navy/70">
          Tous les arrêts sont traités. Lancer le retour au dépôt{depot ? ` (${depot})` : ""}
          {distanceKm !== null ? ` — environ ${distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km à vol d'oiseau` : ""} ?
        </p>
        <a href={lien} target="_blank" rel="noreferrer" onClick={onPlusTard} className="btn-primary min-h-[52px] justify-center text-base">
          <IconNavigation className="h-5 w-5" /> Retour au dépôt avec {nomNavigation}
        </a>
        <button type="button" className="btn-ghost min-h-[44px] justify-center text-sm" onClick={onPlusTard}>
          Plus tard
        </button>
      </section>
    </div>
  );
}
