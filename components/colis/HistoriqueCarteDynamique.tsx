"use client";

import dynamic from "next/dynamic";

/**
 * Carte de l'historique chargée seulement dans le navigateur (audit M20) :
 * maplibre-gl (~800 ko) n'est ni rendu côté serveur ni inclus dans le
 * paquet de la page. `ssr: false` n'est permis que dans un composant
 * client : d'où ce composant intermédiaire, utilisé par le composant
 * serveur HistoriqueTournees.
 */
const HistoriqueCarte = dynamic(() => import("@/components/colis/HistoriqueCarte"), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse rounded-xl bg-navy/[0.05]" aria-label="Chargement de la carte" />,
});

export default HistoriqueCarte;
