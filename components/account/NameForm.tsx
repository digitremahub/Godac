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
 *
 * Address is only shown for chauffeur/manager_chauffeur roles — it's
 * used exclusively to estimate the extra distance of a "retour à
 * domicile" vs. the habitual depot return (lib/business/
 * fuel-profitability.ts), never shown to anyone but the driver
 * themselves and never used for anything else.
 *
 * Contact email is only shown for auth_method='pin' drivers — their
 * real users.email is a never-delivered fabricated address used only
 * as their Supabase Auth identifier (see lib/auth/driver-pin.ts), so
 * without this they could never actually receive an alert/digest/
 * convocation email. Kept separate from EmailForm (which changes the
 * login identity itself) on purpose.
 */
export function NameForm({
  currentName,
  currentPhone,
  currentAddress,
  showAddress = false,
  currentContactEmail,
  showContactEmail = false,
}: {
  currentName: string;
  currentPhone: string | null;
  currentAddress?: string | null;
  showAddress?: boolean;
  currentContactEmail?: string | null;
  showContactEmail?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [phone, setPhone] = useState(currentPhone ?? "");
  const [address, setAddress] = useState(currentAddress ?? "");
  const [contactEmail, setContactEmail] = useState(currentContactEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    name !== currentName ||
    phone !== (currentPhone ?? "") ||
    address !== (currentAddress ?? "") ||
    contactEmail !== (currentContactEmail ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: name,
          phone: phone || null,
          ...(showAddress ? { address: address || null } : {}),
          ...(showContactEmail ? { contact_email: contactEmail || null } : {}),
        }),
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
      {showContactEmail && (
        <div>
          <label className="label">Email de notification (optionnel)</label>
          <input
            className="input"
            type="email"
            placeholder="votre-email@exemple.fr"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <p className="mt-1 text-xs text-navy/60">
            Votre connexion par badge/PIN reste inchangée — cette adresse sert uniquement à recevoir les alertes et
            convocations par email.
          </p>
        </div>
      )}
      {showAddress && (
        <div>
          <label className="label">Adresse du domicile (optionnel)</label>
          <input
            className="input"
            placeholder="ex: 12 rue de la Paix, 75002 Paris"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <p className="mt-1 text-xs text-navy/60">
            Sert uniquement à estimer la distance d&apos;un retour direct à domicile en fin de tournée.
          </p>
        </div>
      )}
      <button className="btn-primary self-start" disabled={busy || !name || !dirty} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Card>
  );
}
