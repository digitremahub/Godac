"use client";

import { useEffect } from "react";
import { BandeauPointage } from "@/components/time-clock/BandeauPointage";
import { useSortieDepot, type FixGps } from "@/components/time-clock/useSortieDepot";

/**
 * Sortie du dépôt dans l'app livreur : tant que l'app est ouverte, que le
 * chauffeur est pointé et qu'aucune tournée n'est en cours, sa position
 * est lue toutes les 60 s (useSortieDepot) ; dès qu'il quitte le dépôt la
 * sortie est pointée à l'heure de sa dernière présence au dépôt, avec un
 * bouton « Annuler ». Monté aussi sur l'écran « Tournée terminée / retour
 * dépôt » : la surveillance reprend à la clôture de la tournée. `flottant` :
 * bandeau épinglé en haut de l'écran (navigation, retour au dépôt).
 * `fix` : dernière position GPS déjà connue de la tournée / de GO Navigation,
 * transmise au serveur même pendant la tournée (mémorise les passages au
 * dépôt). `apresCloture` : la tournée vient d'être close dans cette session.
 * Sans module Pointeuse ou sans pointage assisté, l'API répond
 * « désactivé » et la surveillance s'arrête d'elle-même.
 */
export function SortieDepotLivreur({ actif, flottant = false, fix = null, apresCloture = false }: { actif: boolean; flottant?: boolean; fix?: FixGps | null; apresCloture?: boolean }) {
  const sortie = useSortieDepot({ surveiller: actif, immediat: true, presenceExigee: apresCloture });
  const { signalerPosition } = sortie;
  useEffect(() => {
    if (fix) void signalerPosition(fix);
  }, [fix, signalerPosition]);
  const bandeau = (
    <BandeauPointage
      bandeau={sortie.bandeau}
      occupe={sortie.occupe}
      aideVisible={sortie.aideVisible}
      onFermerAide={sortie.fermerAide}
      onAnnuler={sortie.annuler}
      onPointer={sortie.pointerSortie}
      onPlusTard={sortie.plusTard}
      className={flottant ? "" : "mx-4 mt-3"}
    />
  );
  // Par-dessus GO Navigation (plein écran) ou la feuille de retour au dépôt : le bandeau doit rester visible.
  return flottant ? <div className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] rounded-2xl bg-surface shadow-pop empty:hidden">{bandeau}</div> : bandeau;
}
