"use client";

import Link from "next/link";
import { actionRefus, titreRefus, type Refus } from "@/lib/http/fetch-godac";

/**
 * Bandeau affiché à la place d'un alert() quand une API refuse une action
 * (fetchGodac) : titre selon le code (module, rôle, limite, quota),
 * message du serveur, action adaptée au rôle (Activer, Changer de formule…).
 */
export function BandeauRefus({ refus, direction = false, onFermer }: { refus: Refus | null; direction?: boolean; onFermer?: () => void }) {
  if (!refus) return null;
  const action = actionRefus(refus, direction);
  const grave = refus.code === "ERREUR" || refus.code === "NON_CONNECTE";
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-sm ${grave ? "border-orange/40 bg-orange/10 text-orange-ink" : "border-gold/50 bg-gold/[0.12] text-navy"}`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{titreRefus(refus)}</p>
        <p className="mt-0.5 text-pretty">{refus.message}</p>
      </div>
      {action && (
        <Link href={action.href} className="btn-secondary !py-1.5 text-sm">
          {action.libelle}
        </Link>
      )}
      {onFermer && (
        <button type="button" onClick={onFermer} className="text-xs underline" aria-label="Fermer le message">
          Fermer
        </button>
      )}
    </div>
  );
}
