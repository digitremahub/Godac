"use client";

import dynamic from "next/dynamic";

/** Carte de suivi chargée seulement dans le navigateur (maplibre-gl), comme la carte de l'historique (M20). */
export const SuiviTournees = dynamic(() => import("@/components/suivi/SuiviTournees").then((m) => m.SuiviTournees), {
  ssr: false,
  loading: () => <p className="text-sm text-navy/60">Chargement de la carte…</p>,
});
