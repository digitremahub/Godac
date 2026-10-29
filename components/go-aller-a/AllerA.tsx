"use client";

import { useEffect, useState } from "react";
import { api, type RunResume } from "@/components/colis/commun";
import { EcranArrivee } from "@/components/go-aller-a/EcranArrivee";
import { EcranDestination } from "@/components/go-aller-a/EcranDestination";
import { NavigationLibre } from "@/components/go-aller-a/NavigationLibre";
import { useLieux } from "@/components/go-aller-a/useLieux";
import { usePosition } from "@/components/go-aller-a/usePosition";
import type { MissionLibre } from "@/lib/go-lieux/mission";
import { CLE_AVERTISSEMENT, TEXTE_AVERTISSEMENT, avertissementDejaVu } from "@/lib/go-lieux/saisie";

type Etape = { nom: "destination" } | { nom: "navigation"; mission: MissionLibre } | { nom: "arrivee"; mission: MissionLibre };

/**
 * « Aller à… » : navigation vers une destination libre avec le moteur GO,
 * sans tournée. Tout reste en mémoire : aucune tournée ni arrêt créé, aucun
 * trajet ni position enregistrés (la trace GPS n'est jamais montée ici).
 * Une tournée en cours reste intacte : « Retour à ma tournée » la rouvre.
 */
export function AllerA() {
  const [etape, setEtape] = useState<Etape>({ nom: "destination" });
  const { position, mouvement, erreur, actualiser } = usePosition();
  const lieux = useLieux();
  const [tourneeEnCours, setTourneeEnCours] = useState(false);
  const [avertissement, setAvertissement] = useState(false);

  useEffect(() => {
    try {
      setAvertissement(!avertissementDejaVu(localStorage.getItem(CLE_AVERTISSEMENT)));
    } catch {
      setAvertissement(false);
    }
    let annule = false;
    api<{ tournees: RunResume[] }>("/api/colis/tournees")
      .then((r) => !annule && setTourneeEnCours(r.tournees.some((t) => t.status === "in_progress")))
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, []);

  function compris() {
    setAvertissement(false);
    try {
      localStorage.setItem(CLE_AVERTISSEMENT, "1");
    } catch {
      /* stockage indisponible : l'avertissement reviendra */
    }
  }

  if (etape.nom === "navigation") {
    return <NavigationLibre mission={etape.mission} onArrivee={() => setEtape({ nom: "arrivee", mission: etape.mission })} onQuitter={() => setEtape({ nom: "destination" })} />;
  }
  if (etape.nom === "arrivee") {
    return <EcranArrivee destination={etape.mission.destination} favoris={lieux.favoris} tourneeEnCours={tourneeEnCours} mouvement={mouvement} onEnregistrer={lieux.enregistrerFavori} onNouvelle={() => setEtape({ nom: "destination" })} />;
  }
  return (
    <>
      <EcranDestination position={position} erreurGps={erreur} mouvement={mouvement} onActualiser={actualiser} lieux={lieux} tourneeEnCours={tourneeEnCours} onLancer={(mission) => setEtape({ nom: "navigation", mission })} />
      {avertissement && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="aller-a-avertissement">
          <section className="flex w-full max-w-lg flex-col gap-3 rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
            <h2 id="aller-a-avertissement" className="font-display text-xl font-bold">
              Conduisez prudemment
            </h2>
            <p className="text-sm text-navy/80">{TEXTE_AVERTISSEMENT}</p>
            <button type="button" className="btn-primary min-h-[52px] justify-center text-base" onClick={compris} autoFocus>
              J&apos;ai compris
            </button>
          </section>
        </div>
      )}
    </>
  );
}
