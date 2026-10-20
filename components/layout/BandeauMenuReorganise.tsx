"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Date de fin d'affichage : deux semaines après la mise en ligne de la réorganisation. */
const FIN_AFFICHAGE = Date.parse("2026-11-15T00:00:00+01:00");

export function cleBandeau(userId: string): string {
  return `godac.menu-reorganise.vu.${userId}`;
}

function lire(cle: string): boolean {
  try {
    return window.localStorage.getItem(cle) === "1";
  } catch {
    // Stockage indisponible (navigation privée, données bloquées) : on affiche.
    return false;
  }
}

function memoriser(cle: string) {
  try {
    window.localStorage.setItem(cle, "1");
  } catch {
    // Sans stockage, le bandeau reviendra au prochain chargement : sans gravité.
  }
}

/**
 * Bandeau discret « Le menu a été réorganisé » : une fois par utilisateur,
 * fermable, mémorisé dans le navigateur. Rendu seulement après montage
 * (pas de bandeau dans le HTML serveur, donc pas de clignotement pour qui
 * l'a déjà fermé).
 */
export function BandeauMenuReorganise({ userId }: { userId: string }) {
  const [visible, setVisible] = useState(false);
  const cle = cleBandeau(userId);

  useEffect(() => {
    setVisible(Date.now() < FIN_AFFICHAGE && !lire(cle));
  }, [cle]);

  if (!visible) return null;

  function fermer() {
    memoriser(cle);
    setVisible(false);
  }

  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-teal/30 bg-teal/[0.08] px-4 py-2.5 text-sm text-navy">
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">Le menu a été réorganisé.</strong> Les pages sont regroupées par section (Exploitation, Flotte, Carburant, Équipe…) avec des onglets ; vos anciens liens et favoris
        fonctionnent toujours.
      </p>
      <span className="flex items-center gap-3">
        <Link href="/aide/guide" className="font-semibold text-teal-ink underline underline-offset-2 hover:no-underline" onClick={fermer}>
          Voir le guide
        </Link>
        <button type="button" onClick={fermer} className="inline-flex min-h-[36px] items-center rounded-lg px-2 font-medium text-navy/70 hover:bg-navy/[0.06] hover:text-navy">
          Fermer<span className="sr-only"> le message sur la réorganisation du menu</span>
        </button>
      </span>
    </div>
  );
}
