"use client";

/**
 * Interrupteur « Interface simple » (Livré / Non livré seulement) de la
 * tournée : visible dans la liste et dans le menu de GO, effet immédiat.
 */
export function InterrupteurMode({ simple, onChange, disabled }: { simple: boolean; onChange: (vers: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={simple}
      disabled={disabled}
      onClick={() => onChange(!simple)}
      className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border border-navy/10 bg-surface px-3 text-left text-sm"
    >
      <span className="min-w-0">
        <span className="block font-semibold">Interface simple</span>
        <span className="block text-xs text-navy/60">{simple ? "Livré / Non livré seulement" : "Modes de livraison, preuves, ramasses et relais"}</span>
      </span>
      <span aria-hidden="true" className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${simple ? "justify-end bg-marine" : "justify-start bg-navy/20"}`}>
        <span className="h-6 w-6 rounded-full bg-white shadow-card" />
      </span>
    </button>
  );
}
