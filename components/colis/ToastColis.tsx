"use client";

import { useEffect } from "react";
import type { Toast } from "@/components/colis/commun";

/**
 * Message en haut de l'écran, qui se ferme seul (3,5 s, ou la durée donnée).
 * Les actions (« Annuler ») restent cliquables pendant ce temps ; un clic
 * ferme le message.
 */
export function ToastColis({ toast, onFermer, haut = "top-24" }: { toast: Toast | null; onFermer: () => void; haut?: string }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onFermer, toast.dureeMs ?? 3500);
    return () => clearTimeout(t);
  }, [toast, onFermer]);
  if (!toast) return null;
  return (
    <div role="status" className={`fixed inset-x-4 ${haut} z-[70] mx-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold shadow-pop ${toast.ok ? "bg-marine text-white" : "bg-orange text-on-orange"}`}>
      <span className="min-w-0 flex-1">{toast.text}</span>
      {toast.actions?.map((a) => (
        <button
          key={a.label}
          type="button"
          className="min-h-[44px] shrink-0 rounded-lg px-3 font-bold underline underline-offset-2"
          onClick={() => {
            onFermer();
            a.onClick();
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
