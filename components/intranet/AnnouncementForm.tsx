"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface ServiceOption {
  id: string;
  name: string;
}

export function AnnouncementForm({ services }: { services: ServiceOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          service_id: serviceId || null,
          requires_acknowledgement: requiresAck,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setTitle("");
      setBody("");
      setServiceId("");
      setRequiresAck(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg">Nouvelle annonce</h3>
      {error && <p className="text-sm text-orange-ink">{error}</p>}

      <div>
        <label className="label">Titre</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note de service, convocation…" />
      </div>
      <div>
        <label className="label">Message</label>
        <textarea className="input min-h-24" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Destinataires</label>
          <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Toute l&apos;organisation</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-navy/70">
          <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />
          Accusé de lecture requis
        </label>
      </div>
      <button className="btn-primary self-start" disabled={busy || !title || !body} onClick={submit}>
        {busy ? "Publication…" : "Publier"}
      </button>
    </Card>
  );
}
