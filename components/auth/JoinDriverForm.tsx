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
  const [companyName, setCompanyName] = useState("");
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
          company_name: companyName,
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
        <h1 className="text-xl">Créer mon compte chauffeur</h1>
        <p className="mt-1 text-sm text-navy/65">
          Un responsable devra valider votre compte avant que vous puissiez vous connecter — vous pouvez créer votre code
          PIN dès maintenant, ça ira plus vite ensuite.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className="block"><span className="label">Nom complet</span>
          <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
        </div>
        <div>
          <label className="block"><span className="label">Entreprise pour laquelle vous travaillez</span>
          <input
            className="input"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Nom de votre entreprise"
          /></label>
          <p className="mt-1 text-xs text-navy/60">Doit correspondre à l&apos;entreprise propriétaire de ce lien.</p>
        </div>
        <div>
          <label className="block"><span className="label">Téléphone (optionnel)</span>
          <input className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        </div>
        {services.length > 0 && (
          <div>
            <label className="block"><span className="label">Service (optionnel)</span>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Je ne sais pas / aucun</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select></label>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy || !fullName || !companyName}>
          {busy ? "Création…" : "Créer mon compte"}
        </button>
      </form>
    </Card>
  );
}
