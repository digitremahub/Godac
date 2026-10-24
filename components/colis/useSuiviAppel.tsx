"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { creerSuiviAppel } from "@/lib/colis/suivi-appel";
import type { Stop } from "@/components/colis/commun";

/**
 * Bouton « Appeler » : au retour dans GODAC, une bande propose de cocher
 * « Eu au téléphone » (sans bloquer : elle disparaît seule). `lancerAppel`
 * s'appelle au clic sur le lien tel: ; `proposition` est à afficher.
 */
export function useSuiviAppel(stops: Stop[], onConfirmer: (s: Stop) => void) {
  const suivi = useRef(creerSuiviAppel());
  const [arretId, setArretId] = useState<string | null>(null);
  const lancerAppel = useCallback((s: Stop) => suivi.current.lancer(s.id), []);
  useEffect(() => {
    const maj = () => {
      if (document.visibilityState === "hidden") suivi.current.aQuitte();
      else setArretId(suivi.current.auRetour());
    };
    document.addEventListener("visibilitychange", maj);
    return () => document.removeEventListener("visibilitychange", maj);
  }, []);
  useEffect(() => {
    if (!arretId) return;
    const t = setTimeout(() => setArretId(null), 12_000);
    return () => clearTimeout(t);
  }, [arretId]);
  const stop = arretId ? stops.find((s) => s.id === arretId) : undefined;
  const proposition = stop ? (
    <div role="status" className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[90] mx-auto flex max-w-md items-center gap-2 rounded-2xl bg-marine px-4 py-3 text-sm font-semibold text-white shadow-pop">
      <span className="min-w-0 flex-1">Eu {stop.recipient ?? "le client"} au téléphone ?</span>
      <button
        type="button"
        className="min-h-[44px] rounded-xl bg-white px-4 font-bold text-marine"
        onClick={() => {
          setArretId(null);
          onConfirmer(stop);
        }}
      >
        Oui, cocher
      </button>
      <button type="button" className="min-h-[44px] px-2 text-white/80" onClick={() => setArretId(null)} aria-label="Ignorer">
        Non
      </button>
    </div>
  ) : null;
  return { lancerAppel, proposition };
}
