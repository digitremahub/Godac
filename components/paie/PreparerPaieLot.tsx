"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { ValidationBulletins } from "@/components/paie/ValidationBulletins";
import { networkErrorMessage } from "@/lib/utils/network-error";

/**
 * « Préparer tous les bulletins du mois » en un clic (POST /api/paie/lot),
 * puis, pour la direction, validation des bulletins en attente. La
 * validation reste celle de la direction : le comptable prépare seulement.
 */
export function PreparerPaieLot({ mois, aPreparer, enAttente, peutValider, anomalies }: { mois: string; aPreparer: number; enAttente: string[]; peutValider: boolean; anomalies: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function preparer() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/paie/lot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mois }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Préparation impossible.");
      setMessage({ ok: true, text: typeof json.resume === "string" ? json.resume : "Bulletins préparés." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5 flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {aPreparer > 0 ? (
            <>
              <strong>{aPreparer}</strong> bulletin{aPreparer > 1 ? "s" : ""} à préparer à partir des heures, congés, primes et frais déjà enregistrés. Les bulletins existants ne sont jamais écrasés.
            </>
          ) : (
            "Tous les bulletins du mois sont préparés."
          )}
        </p>
        <button type="button" className="btn-dark w-full sm:w-auto" disabled={busy || aPreparer === 0} onClick={preparer}>
          {busy ? "Préparation…" : `Préparer tous les bulletins (${aPreparer})`}
        </button>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className="text-sm" style={message.ok ? undefined : { color: "#d62718" }}>
          {message.text}
        </p>
      )}
      {enAttente.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-navy/10 pt-3">
          <p className="text-sm">
            <strong>{enAttente.length}</strong> bulletin{enAttente.length > 1 ? "s" : ""} en attente de validation par la direction.
            {anomalies > 0 && <> Relisez d&apos;abord les {anomalies} anomalie{anomalies > 1 ? "s" : ""} ci-dessous.</>}
          </p>
          {peutValider ? <ValidationBulletins ids={enAttente} libelleValider={`Valider les ${enAttente.length} bulletins`} compact /> : <p className="text-xs text-navy/60">La validation est faite par la direction.</p>}
        </div>
      )}
    </Card>
  );
}
