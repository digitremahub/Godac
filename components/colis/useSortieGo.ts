"use client";

import { useCallback, useEffect, useRef } from "react";
import { MARQUE_HISTORIQUE_GO, estEntreeGo, retourFermeGo, routeApresSortie } from "@/lib/colis/sortie-go";

/**
 * Sortie de GO Navigation vers « Ma tournée colis » (lib/colis/sortie-go.ts).
 * À l'ouverture de GO, une entrée est ajoutée à l'historique : le bouton
 * Retour du navigateur ou d'Android la retire et ferme GO, au lieu de quitter
 * la page (et d'arriver sur le tableau de bord). Retourne la fonction qui
 * ferme GO depuis un bouton (même chemin que le retour du navigateur).
 * `onSortie` affiche l'écran de la tournée.
 */
export function useSortieGo(ouvert: boolean, onSortie: () => void): () => void {
  const entreePosee = useRef(false);
  const sortie = useRef(onSortie);
  sortie.current = onSortie;

  const finir = useCallback(() => {
    entreePosee.current = false;
    sortie.current();
    // GO ouvert par son lien direct : l'adresse devient celle de la tournée.
    const route = routeApresSortie(window.location.pathname);
    if (route) {
      try {
        window.history.replaceState(null, "", route);
      } catch {
        /* historique indisponible */
      }
    }
  }, []);

  useEffect(() => {
    if (ouvert) {
      if (!entreePosee.current) {
        try {
          window.history.pushState({ [MARQUE_HISTORIQUE_GO]: true }, "");
          entreePosee.current = true;
        } catch {
          /* historique indisponible : seuls les boutons ferment GO */
        }
      }
      const auRetour = () => {
        if (retourFermeGo(true, entreePosee.current, window.history.state)) finir();
      };
      window.addEventListener("popstate", auRetour);
      return () => window.removeEventListener("popstate", auRetour);
    }
    // GO fermé autrement que par le retour (fin de tournée, aperçu…) : l'entrée posée est retirée.
    if (entreePosee.current && estEntreeGo(window.history.state)) {
      entreePosee.current = false;
      window.history.back();
    }
    entreePosee.current = false;
    return undefined;
  }, [ouvert, finir]);

  return useCallback(() => {
    if (entreePosee.current && estEntreeGo(window.history.state)) window.history.back();
    else finir();
  }, [finir]);
}
