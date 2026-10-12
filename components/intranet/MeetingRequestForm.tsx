"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

export function MeetingRequestForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/meeting-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, preferred_date: preferredDate || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setReason("");
      setPreferredDate("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-secondary self-start" onClick={() => setOpen(true)}>
        📅 Demander un rendez-vous
      </button>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg">Demander un rendez-vous</h3>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      <div>
        <label className="block"><span className="label">Motif</span>
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <div>
        <label className="block"><span className="label">Date souhaitée (optionnel)</span>
        <input className="input" type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} /></label>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !reason} onClick={submit}>
          {busy ? "Envoi…" : "Envoyer la demande"}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </Card>
  );
}
