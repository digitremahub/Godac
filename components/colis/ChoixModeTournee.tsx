"use client";

import { IconCheck, IconX } from "@/components/layout/icons";

/**
 * Choix à la création d'une tournée : interface complète (modes de livraison,
 * preuves, ramasses, relais) ou simple (« Livré » / « Non livré » seulement,
 * pour suivre ses adresses). Modifiable ensuite, même en cours de tournée.
 */
export function ChoixModeTournee({ busy, onChoisir, onFermer }: { busy: boolean; onChoisir: (simple: boolean) => void; onFermer: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="choix-mode-titre">
      <section className="flex w-full max-w-md flex-col gap-3 rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="choix-mode-titre" className="font-display text-xl font-bold">
              Nouvelle tournée colis
            </h2>
            <p className="text-sm text-navy/60">Quelle interface pour cette tournée ? Vous pourrez en changer à tout moment.</p>
          </div>
          <button type="button" className="btn-ghost min-h-[44px] !px-2" onClick={onFermer} aria-label="Fermer">
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <button type="button" className="flex min-h-[72px] flex-col items-start justify-center rounded-2xl border-2 border-teal/60 px-4 py-3 text-left" disabled={busy} onClick={() => onChoisir(false)}>
          <span className="font-bold">Complète</span>
          <span className="text-sm text-navy/65">Mode de remise, preuves, ramasses, points relais.</span>
        </button>
        <button type="button" className="flex min-h-[72px] flex-col items-start justify-center rounded-2xl border-2 border-navy/15 px-4 py-3 text-left" disabled={busy} onClick={() => onChoisir(true)}>
          <span className="flex items-center gap-1.5 font-bold">
            <IconCheck className="h-4 w-4" /> Simple
          </span>
          <span className="text-sm text-navy/65">Seulement « Livré » ou « Non livré », pour suivre vos adresses.</span>
        </button>
      </section>
    </div>
  );
}
