"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

/** "Convoquer" button on a driver's fiche (admin/users/[id]) — direction and chefs d'équipe only. */
export function ConvocationButton({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/convocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employeeId,
          reason,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
          location: location || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setSent(true);
      setOpen(false);
      setReason("");
      setScheduledAt("");
      setLocation("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button className="btn-secondary" onClick={() => setOpen(true)}>
          📋 Convoquer
        </button>
        {sent && <p className="text-xs text-teal-ink">Convocation envoyée.</p>}
      </div>
    );
  }

  return (
    <Card className="flex max-w-sm flex-col gap-3">
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      <div>
        <label className="label">Motif *</label>
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div>
        <label className="label">Date et heure (optionnel)</label>
        <input className="input" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
      </div>
      <div>
        <label className="label">Lieu (optionnel)</label>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !reason.trim()} onClick={submit}>
          {busy ? "Envoi…" : "Envoyer la convocation"}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </Card>
  );
}
