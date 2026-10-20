"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

/**
 * Lets a chauffeur (ou manager qui conduit) turn their own QR badge (shown
 * next to this card on /account) into a working login — the same
 * scan-while-signed-out flow Lot 7 built for no-email accounts
 * (app/driver-pin/[id]), just self-activated here instead of
 * admin-created. Setting a PIN replaces whatever password the account
 * had: afterwards the badge scan *and* the PIN typed on /sign-in both
 * work, the old password doesn't.
 */
export function DriverPinForm({ pinAlreadySet }: { pinAlreadySet: boolean }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/account/pin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, confirmPin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setSaved(true);
      setPin("");
      setConfirmPin("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-md flex-col gap-4">
      <div>
        <h3 className="text-lg">Connexion par badge (code PIN)</h3>
        <p className="mt-1 text-sm text-navy/65">
          {pinAlreadySet
            ? "Activée — scannez votre badge ci-dessus pour vous connecter avec ce code. Vous pouvez le changer ici."
            : "Activez un code PIN (4 à 6 chiffres) : vous pourrez ensuite vous connecter en scannant votre badge, sans mot de passe à retenir. Cela remplace votre mot de passe actuel."}
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {saved && <p role="status" className="text-sm text-teal-ink">Code PIN enregistré.</p>}
      <div>
        <label className="block"><span className="label">{pinAlreadySet ? "Nouveau code PIN" : "Code PIN"}</span>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        /></label>
      </div>
      <div>
        <label className="block"><span className="label">Confirmez le code PIN</span>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value)}
        /></label>
      </div>
      <button className="btn-primary self-start" disabled={busy || !pin || !confirmPin} onClick={save}>
        {busy ? "Enregistrement…" : pinAlreadySet ? "Changer mon code PIN" : "Activer la connexion par badge"}
      </button>
    </Card>
  );
}
