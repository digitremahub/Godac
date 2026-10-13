"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Code de secours encore à 6 chiffres : le salarié renseigne sa date de
 * naissance pour obtenir le code « initiales + mois/année » (ex : FT1188),
 * plus facile à retenir à la pompe.
 */
export function CodeSecoursNaissance() {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enregistrer() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/birth-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birth_date: date }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-navy/[0.04] p-3 text-sm">
      <p className="font-semibold">Un code de secours plus simple</p>
      <p className="mt-0.5 text-xs text-navy/65">
        Indiquez votre date de naissance : votre code devient vos initiales + mois et année de naissance (ex : FT1188).
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          className="input !w-auto !py-1.5"
          type="date"
          aria-label="Date de naissance"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button className="btn-primary !py-1.5 text-sm" disabled={busy || !date} onClick={enregistrer}>
          {busy ? "Enregistrement…" : "Valider"}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-orange-ink">{error}</p>}
    </div>
  );
}
