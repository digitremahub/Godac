"use client";

import Link from "next/link";
import { useState } from "react";
import { EnregistrerFavori } from "@/components/go-aller-a/EnregistrerFavori";
import { memeLieu, type Lieu, type LieuSaisie, type TypeLieuFixe } from "@/lib/go-lieux/lieux";
import type { Destination } from "@/lib/go-lieux/mission";

/** Arrivée : message, « Ajouter aux favoris », « Nouvelle destination », « Retour à ma tournée » (si une tournée est en cours ; elle n'a pas bougé). */
export function EcranArrivee({
  destination,
  favoris,
  tourneeEnCours,
  mouvement,
  onEnregistrer,
  onNouvelle,
}: {
  destination: Destination;
  favoris: readonly Lieu[];
  tourneeEnCours: boolean;
  mouvement: boolean;
  onEnregistrer: (lieu: LieuSaisie, type: TypeLieuFixe | null) => Promise<boolean>;
  onNouvelle: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const dejaFavori = favoris.some((f) => memeLieu(f, destination));
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 bg-paper p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div role="status" className="text-center">
        <p className="font-display text-3xl font-bold">Vous êtes arrivé</p>
        <p className="mt-2 text-lg font-semibold">{destination.libelle}</p>
        {destination.libelle !== destination.adresse && <p className="text-sm text-navy/65">{destination.adresse}</p>}
      </div>
      {ouvert ? (
        <EnregistrerFavori lieu={destination} mouvement={mouvement} onEnregistrer={onEnregistrer} onFermer={() => setOuvert(false)} />
      ) : (
        <>
          <button type="button" className="btn-primary min-h-[52px] justify-center text-base" onClick={onNouvelle}>
            Nouvelle destination
          </button>
          {tourneeEnCours && (
            <Link href="/livreur" className="btn-dark flex min-h-[52px] items-center justify-center text-base">
              Retour à ma tournée
            </Link>
          )}
          {!dejaFavori && (
            <button type="button" className="btn-secondary min-h-[52px] justify-center" onClick={() => setOuvert(true)}>
              ☆ Ajouter aux favoris
            </button>
          )}
          {!tourneeEnCours && (
            <Link href="/livreur" className="btn-ghost flex min-h-[44px] items-center justify-center text-sm">
              Ma tournée colis
            </Link>
          )}
        </>
      )}
    </main>
  );
}
