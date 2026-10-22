"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { IconAlertTriangle, IconRefresh } from "@/components/layout/icons";

/**
 * Écran d'erreur des pages de l'espace connecté (error.tsx) : un message
 * simple, sans détail technique, et « Réessayer », qui relance le rendu
 * serveur (router.refresh) puis réaffiche la page (reset).
 */
export function EcranErreur({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();

  useEffect(() => {
    // Trace côté navigateur pour le support ; rien de technique à l'écran.
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange/10 text-orange-ink">
        <IconAlertTriangle className="h-6 w-6" />
      </span>
      <h1 className="font-display text-xl font-bold">Un problème est survenu</h1>
      <p className="text-sm text-navy/70">La page n&apos;a pas pu s&apos;afficher. Réessayez dans un instant ; si le problème continue, contactez le support.</p>
      {error.digest && <p className="text-xs text-navy/50">Référence : {error.digest}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          className="btn-primary min-h-[44px]"
          disabled={enCours}
          onClick={() =>
            demarrer(() => {
              router.refresh();
              reset();
            })
          }
        >
          <IconRefresh className="h-4 w-4" /> {enCours ? "Nouvel essai…" : "Réessayer"}
        </button>
        <Link href="/dashboard" className="btn-secondary min-h-[44px]">
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
