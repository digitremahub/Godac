"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { dateParis } from "@/lib/colis/heure-paris";
import { arretsVirtuels, estDerniere, tourneeVirtuelle, type MissionLibre } from "@/lib/go-lieux/mission";
import type { Run, Stop } from "@/components/colis/commun";

const GoNavigation = dynamic(() => import("@/components/colis/GoNavigation").then((m) => m.GoNavigation), {
  ssr: false,
  loading: () => <p className="fixed inset-0 z-40 grid place-items-center bg-paper text-sm text-navy/60">Chargement de GO…</p>,
});

const rien = () => undefined;
const rienAsync = async () => undefined;

/**
 * Couche mince « mission libre » : donne au moteur GO existant une tournée et
 * des arrêts VIRTUELS, en mémoire. Rien n'est écrit en base (ni delivery_run,
 * ni delivery_stop), la trace GPS n'est jamais montée et la position n'est
 * jamais remontée : GoNavigation reçoit `libre` et ignore tout ce qui touche
 * une tournée.
 */
export function NavigationLibre({ mission, onArrivee, onQuitter }: { mission: MissionLibre; onArrivee: () => void; onQuitter: () => void }) {
  const [atteints, setAtteints] = useState<Set<number>>(new Set());
  const stops = useMemo(() => arretsVirtuels(mission, atteints) as unknown as Stop[], [mission, atteints]);
  const run = useMemo(() => tourneeVirtuelle() as unknown as Run, []);
  const horaires = useMemo(() => ({ jour: dateParis(new Date()), depart: 0, fenetres: new Map(), passages: new Map() }), []);
  const avancement = useMemo(() => ({ adressesRestantes: stops.length - atteints.size, colisRestants: 0, adressesFaites: atteints.size, adressesTotal: stops.length, finEstimee: null, methode: null }), [stops.length, atteints.size]);
  const onAtteint = useCallback(
    (index: number) => {
      setAtteints((a) => new Set(a).add(index));
      if (estDerniere(mission, index)) onArrivee();
    },
    [mission, onArrivee],
  );
  return (
    <GoNavigation
      run={run}
      stops={stops}
      lists={[]}
      horaires={horaires as never}
      avancement={avancement}
      busy={false}
      onFermer={onQuitter}
      onRecharger={rienAsync}
      onToast={rien}
      modeSimple
      onModeSimple={rien}
      onContact={rien}
      onRetirer={rien}
      onAppel={rien}
      onTerminer={rien}
      onCloture={rien}
      onTelephone={rien}
      onHoraires={rien}
      onPasser={rien}
      onDeposer={rienAsync}
      onReoptimiser={rienAsync}
      onItineraire={rien}
      onPosition={rien}
      traceActive={false}
      libre={{ onAtteint, onQuitter }}
    />
  );
}
