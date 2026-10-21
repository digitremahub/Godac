"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

export function DriverContactForm({
  userId,
  currentPhone,
  currentAddress,
  currentContactEmail,
  canEditAll,
}: {
  userId: string;
  currentPhone: string | null;
  currentAddress: string | null;
  currentContactEmail: string | null;
  canEditAll: boolean;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(currentPhone ?? "");
  const [address, setAddress] = useState(currentAddress ?? "");
  const [email, setEmail] = useState(currentContactEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = phone !== (currentPhone ?? "") || address !== (currentAddress ?? "") || email !== (currentContactEmail ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() || null, address: address.trim() || null, contact_email: email.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Impossible d'enregistrer les coordonnées.");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">Coordonnées du chauffeur</h2>
        <p className="mt-1 text-sm text-navy/60">
          {canEditAll ? "La direction (ou l'exploitation pour un chauffeur ou un manager) peut mettre à jour les coordonnées de cette fiche." : "Exploitation : modification limitée aux coordonnées des chauffeurs de vos services."}
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {saved && <p role="status" className="text-sm text-teal-ink">Coordonnées enregistrées.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Téléphone</span>
          <input className="input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" />
        </label>
        <label className="block">
          <span className="label">Email de contact</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="chauffeur@exemple.fr" />
          <span className="mt-1 block text-xs text-navy/60">Utilisé pour les notifications et convocations. Ne modifie pas l'adresse de connexion.</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Adresse du domicile</span>
          <input className="input" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 rue de la Paix, 75000 Paris" />
        </label>
      </div>
      <button className="btn-primary self-start" disabled={busy || !dirty || (!!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer les coordonnées"}
      </button>
    </Card>
  );
}
