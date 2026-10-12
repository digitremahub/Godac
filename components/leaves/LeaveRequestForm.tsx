"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface ServiceOption {
  id: string;
  name: string;
}

export function LeaveRequestForm({ services }: { services: ServiceOption[] }) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch("/api/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: serviceId, start_date: startDate, end_date: endDate, reason: reason || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setSent(true);
      setStartDate("");
      setEndDate("");
      setReason("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (services.length === 0) {
    return (
      <Card className="text-sm text-navy/65">
        Vous n&apos;êtes rattaché à aucun service — contactez votre direction pour pouvoir demander un congé.
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg">Nouvelle demande de congé</h3>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {sent && <p className="text-sm text-teal-ink">Demande envoyée, en attente de validation.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
        {services.length > 1 && (
          <div>
            <label className="label">Service</label>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Du</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Au</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className={services.length > 1 ? "sm:col-span-1" : "sm:col-span-2"}>
          <label className="label">Motif (optionnel)</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Congés payés, RTT…" />
        </div>
      </div>
      <button
        className="btn-primary self-start"
        disabled={busy || !serviceId || !startDate || !endDate}
        onClick={submit}
      >
        {busy ? "Envoi…" : "Envoyer la demande"}
      </button>
    </Card>
  );
}
