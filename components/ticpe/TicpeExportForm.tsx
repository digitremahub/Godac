"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

export function TicpeExportForm() {
  const router = useRouter();
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const [start, setStart] = useState(firstOfMonth);
  const [end, setEnd] = useState(today.toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
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
        <label className="label">Du</label>
        <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div>
        <label className="label">Au</label>
        <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <button className="btn-primary" disabled={busy} onClick={generate}>
        {busy ? "Génération…" : "Générer l'export TICPE"}
      </button>
      {error && <p className="text-sm text-orange">{error}</p>}
    </Card>
  );
}
