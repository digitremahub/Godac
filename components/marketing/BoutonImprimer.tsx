"use client";

import { useEffect } from "react";

/** Imprimer ou enregistrer en PDF (boîte d'impression du navigateur). */
export function BoutonImprimer() {
  return (
    <button type="button" className="btn-primary" onClick={() => window.print()}>
      Imprimer / enregistrer en PDF
    </button>
  );
}

/**
 * Document à imprimer : toujours en thème clair, même si l'utilisateur a
 * choisi le mode sombre (le thème est rétabli en quittant la page).
 */
export function ThemeClairPourImpression() {
  useEffect(() => {
    const root = document.documentElement;
    const avant = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "light");
    return () => {
      if (avant === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", avant);
    };
  }, []);
  return null;
}
