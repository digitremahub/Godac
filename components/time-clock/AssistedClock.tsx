"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { BandeauPointage } from "@/components/time-clock/BandeauPointage";
import { heureParis } from "@/components/time-clock/position";
import { useSortieDepot } from "@/components/time-clock/useSortieDepot";

const OFFER_OUT_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Pointage assisté du tableau de bord — lit la position une fois à
 * l'ouverture (jamais en arrière-plan) et demande au serveur
 * (app/api/time-clock/assisted) si le salarié est à un de ses dépôts :
 * entrée automatique avec « Annuler » ; sortie proposée une fois la
 * tournée close ; et, si la sortie du dépôt n'a pas pu être pointée
 * pendant que l'app était fermée, proposition de sortie à l'heure de la
 * dernière présence au dépôt ou maintenant. Tant que la page reste
 * ouverte et la tournée close, la même logique que l'app livreur
 * (useSortieDepot) surveille le départ du dépôt toutes les 60 s.
 * Rendu seulement si l'organisation a activé le pointage assisté.
 */
export function AssistedClock({ hasOpenTour }: { hasOpenTour: boolean }) {
  const router = useRouter();
  const sortie = useSortieDepot({ surveiller: !hasOpenTour, immediat: false });
  const { setBandeau, sonder } = sortie;
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const { json } = await sonder("ouverture");
      if (!json) return;
      if (json.status === "auto_clocked_in" && json.clockedInAt && json.entryId) {
        setBandeau({ kind: "auto_in", entryId: json.entryId, time: heureParis(json.clockedInAt) });
        router.refresh();
      } else if (
        json.status === "clocked_in" &&
        json.atDepot &&
        !hasOpenTour &&
        json.clockedInAt &&
        Date.now() - new Date(json.clockedInAt).getTime() > OFFER_OUT_AFTER_MS
      ) {
        setBandeau({ kind: "offer_out" });
      }
    })();
  }, [hasOpenTour, router, sonder, setBandeau]);

  return (
    <BandeauPointage
      bandeau={sortie.bandeau}
      occupe={sortie.occupe}
      aideVisible={sortie.aideVisible}
      onFermerAide={sortie.fermerAide}
      onAnnuler={sortie.annuler}
      onPointer={sortie.pointerSortie}
      onPlusTard={sortie.plusTard}
    />
  );
}
