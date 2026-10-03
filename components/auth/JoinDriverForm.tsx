"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

interface ServiceOption {
  id: string;
  name: string;
}

/**
 * The form half of app/join/[token] — on success, hands straight off
 * to the existing badge/PIN flow (app/driver-pin/[id]) so creating the
 * account and setting a PIN feel like one continuous step instead of
 * "come back later once you're approved".
 */
export function JoinDriverForm({ token, services }: { token: string; services: ServiceOption[] }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/driver-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          full_name: fullName,
          phone: phone || undefined,
          service_id: serviceId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      window.location.href = `/driver-pin/${json.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  return (
    <Card className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <h2 className="text-xl">Créer mon compte chauffeur</h2>
        <p className="mt-1 text-sm text-navy/50">
          Un responsable devra valider votre compte avant que vous puissiez vous connecter — vous pouvez créer votre code
          PIN dès maintenant, ça ira plus vite ensuite.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className="label">Nom complet</label>
          <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="label">Téléphone (optionnel)</label>
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {services.length > 0 && (
          <div>
            <label className="label">Service (optionnel)</label>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Je ne sais pas / aucun</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="text-sm text-orange-ink">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy || !fullName}>
          {busy ? "Création…" : "Créer mon compte"}
        </button>
      </form>
    </Card>
  );
}
