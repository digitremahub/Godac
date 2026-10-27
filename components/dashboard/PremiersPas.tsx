"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconX } from "@/components/layout/icons";
import { PREMIERS_PAS_FERME, PREMIERS_PAS_REPLIE_PAR_DEFAUT, PREMIERS_PAS_VU, afficherPremiersPas, libellePremiersPas, type PremierPas } from "@/lib/guides/premiers-pas";

/**
 * Ligne d'accueil « Premiers pas · N actions », repliée par défaut (le titre
 * et les décisions restent en haut de l'écran). Dépliée : pastilles
 * défilables à l'horizontale. N'apparaît qu'à la première visite sur cet
 * appareil (localStorage : « vu » dès l'affichage, « ferme » avec la croix) ;
 * lecture et écriture protégées, sans stockage elle reste simplement
 * refermable. Ne bloque jamais la page.
 */
export function PremiersPas({ pas, cle }: { pas: PremierPas[]; cle: string }) {
  const [visible, setVisible] = useState(false);
  const [deplie, setDeplie] = useState(!PREMIERS_PAS_REPLIE_PAR_DEFAUT);
  useEffect(() => {
    let memorise: string | null = null;
    try {
      memorise = window.localStorage.getItem(cle);
    } catch {
      /* stockage indisponible : affiché, replié */
    }
    if (!afficherPremiersPas(memorise)) return;
    setVisible(true);
    try {
      window.localStorage.setItem(cle, PREMIERS_PAS_VU);
    } catch {
      /* stockage indisponible : réaffiché à la prochaine visite seulement */
    }
  }, [cle]);
  if (!visible || pas.length === 0) return null;
  const fermer = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(cle, PREMIERS_PAS_FERME);
    } catch {
      /* stockage indisponible : fermé pour cette visite seulement */
    }
  };
  return (
    <section aria-labelledby="titre-premiers-pas" className="mb-3 rounded-2xl border border-navy/10 bg-surface">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setDeplie((d) => !d)}
          aria-expanded={deplie}
          aria-controls="liste-premiers-pas"
          className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-2 px-3.5 text-left text-sm font-semibold"
        >
          <span id="titre-premiers-pas" className="truncate">
            {libellePremiersPas(pas.length)}
          </span>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`h-4 w-4 shrink-0 text-navy/60 transition-transform ${deplie ? "rotate-180" : ""}`}>
            <path d="m5 8 5 5 5-5" />
          </svg>
        </button>
        <button type="button" onClick={fermer} aria-label="Fermer les premiers pas" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-navy/55 hover:text-navy">
          <IconX className="h-4 w-4" />
        </button>
      </div>
      {deplie && (
        <ul id="liste-premiers-pas" className="flex gap-2 overflow-x-auto px-3.5 pb-3">
          {pas.map((p) => (
            <li key={p.href} className="shrink-0">
              <Link href={p.href} className="btn-secondary inline-flex min-h-[44px] items-center whitespace-nowrap text-sm">
                {p.titre}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
