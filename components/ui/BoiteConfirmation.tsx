"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { fileConfirmation, indexFocusSuivant } from "@/lib/ui/confirmation";

const FOCALISABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Boîte de confirmation unique de GODAC, montée une fois (app/layout.tsx) ;
 * on l'appelle avec `confirmer()` (lib/ui/confirmation.ts).
 *
 * Accessibilité : role="alertdialog", aria-modal, titre et message reliés
 * (aria-labelledby / aria-describedby), focus piégé dans la boîte, Échap
 * et clic hors de la boîte annulent, focus rendu à l'élément d'origine.
 * Action destructrice : focus initial sur « Annuler ». Couleurs du thème
 * (surface, encre, boutons) : lisible dans les 5 thèmes. Boutons de 44 px.
 */
export function BoiteConfirmation() {
  const demande = useSyncExternalStore(fileConfirmation.abonner, fileConfirmation.courante, () => null);
  const boite = useRef<HTMLDivElement>(null);
  const annuler = useRef<HTMLButtonElement>(null);
  const valider = useRef<HTMLButtonElement>(null);
  const origine = useRef<HTMLElement | null>(null);

  useEffect(() => fileConfirmation.enregistrerHote(), []);

  useEffect(() => {
    if (!demande) return;
    origine.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (demande.danger ? annuler.current : valider.current)?.focus();
    const retour = origine.current;
    return () => {
      // Rend le focus à l'élément d'origine s'il est toujours dans la page.
      if (retour?.isConnected) retour.focus();
    };
  }, [demande]);

  if (!demande) return null;

  const repondre = (ok: boolean) => fileConfirmation.repondre(demande.id, ok);

  function surTouche(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      repondre(false);
      return;
    }
    if (e.key !== "Tab") return;
    const elements = Array.from(boite.current?.querySelectorAll<HTMLElement>(FOCALISABLES) ?? []);
    const i = indexFocusSuivant(elements.length, elements.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (i < 0) return;
    e.preventDefault();
    elements[i]!.focus();
  }

  const titreId = `confirmation-titre-${demande.id}`;
  const messageId = `confirmation-message-${demande.id}`;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-navy/60 p-3 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) repondre(false);
      }}
    >
      <div
        ref={boite}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titreId}
        aria-describedby={messageId}
        onKeyDown={surTouche}
        className="w-full max-w-md rounded-2xl bg-surface p-5 text-navy shadow-pop"
      >
        <h2 id={titreId} className="font-display text-lg font-bold">
          {demande.titre}
        </h2>
        <p id={messageId} className="mt-2 whitespace-pre-line text-sm text-navy/75">
          {demande.message}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button ref={annuler} type="button" className="btn-secondary min-h-[44px] justify-center" onClick={() => repondre(false)}>
            {demande.annuler}
          </button>
          <button ref={valider} type="button" className={`${demande.danger ? "btn-danger" : "btn-primary"} min-h-[44px] justify-center`} onClick={() => repondre(true)}>
            {demande.action}
          </button>
        </div>
      </div>
    </div>
  );
}
