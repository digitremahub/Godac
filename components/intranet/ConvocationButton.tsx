"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { IconMegaphone } from "@/components/layout/icons";

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
          <IconMegaphone className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Convoquer
        </button>
        {sent && <p role="status" className="text-xs text-teal-ink">Convocation envoyée.</p>}
      </div>
    );
  }

  return (
    <Card className="flex max-w-sm flex-col gap-3">
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      <div>
        <label className="block"><span className="label">Motif *</span>
        <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <div>
        <label className="block"><span className="label">Date et heure (optionnel)</span>
        <input className="input" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
      </div>
      <div>
        <label className="block"><span className="label">Lieu (optionnel)</span>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
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
