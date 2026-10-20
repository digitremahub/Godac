"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Petite fenêtre du planning (ajout, modification, duplication) :
 * centrée sur ordinateur, en bas de l'écran sur téléphone. Échap ou clic
 * à côté pour fermer ; le focus va au premier champ à l'ouverture et
 * revient où il était à la fermeture.
 */
export function Fenetre({
  titre,
  sousTitre,
  onFermer,
  children,
  large = false,
}: {
  titre: string;
  sousTitre?: string;
  onFermer: () => void;
  children: ReactNode;
  large?: boolean;
}) {
  const id = useId();
  const boite = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    const premier =
      boite.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      boite.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), button:not([disabled])");
    premier?.focus();
    function touche(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onFermer();
      }
    }
    window.addEventListener("keydown", touche);
    return () => {
      window.removeEventListener("keydown", touche);
      precedent?.focus?.();
    };
    // Ouverture seulement : onFermer change à chaque rendu du parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-marine/40 sm:items-center sm:p-4" onClick={onFermer}>
      <div
        ref={boite}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titre`}
        className={`flex max-h-[92vh] w-full flex-col overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-5 shadow-pop sm:rounded-2xl ${large ? "sm:max-w-xl" : "sm:max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${id}-titre`} className="font-display text-lg font-bold leading-tight">
              {titre}
            </h2>
            {sousTitre && <p className="mt-0.5 text-sm text-navy/65">{sousTitre}</p>}
          </div>
          <button
            type="button"
            className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl text-navy/60 hover:bg-navy/[0.05] hover:text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
            onClick={onFermer}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Cases L M M J V S D à cocher (une ou deux semaines). */
export function ChoixJours({
  semaines,
  coches,
  onBasculer,
  desactive,
}: {
  semaines: { titre: string; jours: string[] }[];
  coches: ReadonlySet<string>;
  onBasculer: (date: string) => void;
  /** Jour source : affiché mais non cochable. */
  desactive?: string;
}) {
  const LETTRES = ["L", "M", "M", "J", "V", "S", "D"];
  const NOMS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  return (
    <div className="flex flex-col gap-2">
      {semaines.map((s) => (
        <fieldset key={s.titre}>
          <legend className="mb-1 text-xs font-medium text-navy/65">{s.titre}</legend>
          <div className="flex flex-wrap gap-1.5">
            {s.jours.map((d, i) => {
              const actif = coches.has(d);
              const source = d === desactive;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={actif}
                  aria-label={`${NOMS[i]} ${d.slice(8, 10)}/${d.slice(5, 7)}${source ? " (jour d'origine)" : ""}`}
                  disabled={source}
                  onClick={() => onBasculer(d)}
                  className={`flex h-11 w-11 flex-col items-center justify-center rounded-lg border text-sm font-semibold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
                    source
                      ? "cursor-not-allowed border-dashed border-navy/20 text-navy/35"
                      : actif
                        ? "border-teal bg-teal/20 text-teal-ink"
                        : "border-navy/15 bg-surface text-navy/70 hover:border-teal/50"
                  }`}
                >
                  {LETTRES[i]}
                  <span className="mt-0.5 text-[10px] font-normal">{d.slice(8, 10)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
