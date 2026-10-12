"use client";

import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Card } from "@/components/ui";

interface Credential {
  id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

/**
 * Face ID / empreinte as a login shortcut on this device — additive
 * only, see lib/auth/webauthn.ts: the PIN (chauffeurs) or lien
 * magique/mot de passe (bureau) always still works, so there's no
 * recovery flow to build for a lost or changed device. Available to
 * every role, unlike the address/contact-email fields above it on
 * this page.
 */
export function PasskeyManager() {
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/auth/passkey");
    const json = await res.json();
    if (res.ok) setCredentials(json.credentials);
  }

  useEffect(() => {
    load();
  }, []);

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(typeof options.error === "string" ? options.error : "Erreur");

      const attestation = await startRegistration({ optionsJSON: options });

      const deviceName =
        typeof navigator !== "undefined" && /iphone|ipad/i.test(navigator.userAgent)
          ? "iPhone/iPad"
          : typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
            ? "Android"
            : "Cet appareil";

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, device_name: deviceName }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(typeof verifyJson.error === "string" ? verifyJson.error : "Erreur");
      await load();
    } catch (e) {
      // A user cancelling the OS prompt throws a DOMException — not a real error to surface.
      if (e instanceof Error && e.name !== "NotAllowedError") {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/passkey/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erreur");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-md flex-col gap-3">
      <div>
        <h3 className="text-lg">Face ID / empreinte</h3>
        <p className="mt-1 text-sm text-navy/65">
          Connectez-vous plus vite sur cet appareil, sans retaper votre code ou attendre un email. Votre moyen de
          connexion habituel reste disponible en secours.
        </p>
      </div>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {credentials && credentials.length > 0 && (
        <ul className="flex flex-col gap-2">
          {credentials.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg bg-navy/5 px-3 py-2 text-sm">
              <span>
                {c.device_name ?? "Appareil"}
                <span className="ml-2 text-xs text-navy/60">
                  ajouté le {new Date(c.created_at).toLocaleDateString("fr-FR")}
                </span>
              </span>
              <button className="text-navy/60 hover:text-orange-ink" disabled={busy} onClick={() => remove(c.id)} aria-label="Retirer">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn-secondary self-start" disabled={busy} onClick={register}>
        {busy ? "…" : "+ Activer sur cet appareil"}
      </button>
    </Card>
  );
}
