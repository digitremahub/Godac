"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

export function TicpeExportForm() {
  const router = useRouter();
  const today = new Date();
  // Dates locales (heure de Paris) : toISOString() donnerait la veille entre minuit et 2 h.
  const jour = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const firstOfMonth = jour(new Date(today.getFullYear(), today.getMonth(), 1));
  const [start, setStart] = useState(firstOfMonth);
  const [end, setEnd] = useState(jour(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (start > end) {
      setError("La fin de période précède le début.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ticpe/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period_start: start, period_end: end }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      if (json.downloadUrl) window.open(json.downloadUrl, "_blank");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end">
      <div>
        <label className="block"><span className="label">Du</span>
        <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>
      <div>
        <label className="block"><span className="label">Au</span>
        <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <button className="btn-primary" disabled={busy} onClick={generate}>
        {busy ? "Génération…" : "Générer l'export TICPE"}
      </button>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
    </Card>
  );
}
