"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

/**
 * Fixes a gap organic sign-ups have always had: the sign-up form only
 * ever asked for an email (magic link), so a profile's full_name
 * silently fell back to the email address itself (see
 * app/api/onboarding/create-organization/route.ts and
 * lib/auth/provisioning.ts) until corrected here. Phone lives on the
 * same card since it's just as self-editable and just as often never
 * set at sign-up — it's what a manager's "Envoyer sur WhatsApp" link
 * on the planning grid needs (components/planning/PlanningGrid).
 */
export function NameForm({ currentName, currentPhone }: { currentName: string; currentPhone: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [phone, setPhone] = useState(currentPhone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = name !== currentName || phone !== (currentPhone ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name, phone: phone || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-md flex-col gap-4">
      <h3 className="text-lg">Profil</h3>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {saved && <p className="text-sm text-teal-ink">Profil mis à jour.</p>}
      <div>
        <label className="label">Nom complet</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Téléphone (optionnel)</label>
        <input
          className="input"
          type="tel"
          placeholder="ex: 06 12 34 56 78"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <button className="btn-primary self-start" disabled={busy || !name || !dirty} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Card>
  );
}
