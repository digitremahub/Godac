"use client";

import { useEffect } from "react";
import "./globals.css";
import { signalerErreur } from "@/lib/observabilite/signaler-erreur";

/**
 * Dernier filet : erreur dans le layout racine lui-même (error.tsx ne
 * l'attrape pas). Remplace toute la page, donc <html> et <body> ici.
 */
export default function ErreurGlobale({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    signalerErreur("global", error);
  }, [error]);

  return (
    <html lang="fr">
      <body>
        <div role="alert" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="font-display text-xl font-bold">Un problème est survenu</h1>
          <p className="text-sm text-navy/70">L&apos;application n&apos;a pas pu s&apos;afficher. Réessayez dans un instant ; si le problème continue, contactez le support.</p>
          {error.digest && <p className="text-xs text-navy/50">Référence : {error.digest}</p>}
          <button type="button" className="btn-primary min-h-[44px]" onClick={() => reset()}>
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
