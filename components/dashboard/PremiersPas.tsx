"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PremierPas } from "@/lib/guides/premiers-pas";

/**
 * Bandeau d'accueil refermable : quelques actions clés du rôle. Fermé une
 * fois, il ne revient plus sur cet appareil (localStorage, lecture et
 * écriture protégées : sans stockage il reste simplement refermable pour la
 * session). Ne bloque jamais la page.
 */
export function PremiersPas({ pas, cle }: { pas: PremierPas[]; cle: string }) {
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => {
    try {
      setOuvert(window.localStorage.getItem(cle) !== "ferme");
    } catch {
      setOuvert(true);
    }
  }, [cle]);
  if (!ouvert || pas.length === 0) return null;
  const fermer = () => {
    setOuvert(false);
    try {
      window.localStorage.setItem(cle, "ferme");
    } catch {
      /* stockage indisponible : fermé pour cette visite seulement */
    }
  };
  return (
    <section aria-labelledby="titre-premiers-pas" className="card mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 id="titre-premiers-pas" className="text-base font-semibold">
          Premiers pas
        </h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {pas.map((p) => (
            <li key={p.href}>
              <Link href={p.href} className="btn-secondary inline-flex min-h-[44px] items-center text-sm">
                {p.titre}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" onClick={fermer} className="btn-secondary min-h-[44px] shrink-0 text-sm" aria-label="Fermer les premiers pas">
        Fermer
      </button>
    </section>
  );
}
