"use client";

import { useState } from "react";
import { TITRE_BANDEAU_IMPAYE } from "@/lib/stripe/impaye";

/**
 * Bandeau des réglages de facturation quand une facture est restée impayée.
 * L'accès aux modules n'est pas coupé : le bandeau invite à régulariser le
 * moyen de paiement dans le portail Stripe.
 */
export function BandeauImpaye({ depuisLe, peutRegulariser }: { depuisLe: string | null; peutRegulariser: boolean }) {
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function ouvrirPortail() {
    setBusy(true);
    setErreur(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      window.location.href = json.url;
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  return (
    <div role="alert" className="mb-5 flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "#d62718" }}>
      <div>
        <p className="font-semibold" style={{ color: "#d62718" }}>
          {TITRE_BANDEAU_IMPAYE}
        </p>
        <p className="text-navy/75">
          Le dernier paiement de votre abonnement a échoué{depuisLe ? ` (depuis le ${new Date(depuisLe).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })})` : ""}. Vos modules restent accessibles pour le moment ; mettez à jour votre moyen de paiement pour éviter une
          interruption.
        </p>
        {erreur && <p className="mt-1 text-xs" style={{ color: "#d62718" }}>{erreur}</p>}
      </div>
      {peutRegulariser && (
        <button type="button" className="btn-dark w-full sm:w-auto" disabled={busy} onClick={ouvrirPortail}>
          {busy ? "…" : "Régulariser le paiement"}
        </button>
      )}
    </div>
  );
}
