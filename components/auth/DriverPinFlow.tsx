"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { tryPasskeyLogin } from "@/lib/auth/passkey-login";
import { Card } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";

/**
 * The two faces of the same badge scan: a driver who has never set a
 * PIN gets "créez votre code", one who already has gets "entrez votre
 * code". Both end the same way — a real Supabase Auth session via
 * signInWithPassword, exactly like AuthForm.tsx's password path, just
 * with a PIN playing the password's role.
 *
 * A third case, pendingApproval (app/join/[token] self-signup, not
 * yet approved by a manager-like/direction from /driver-signups):
 * never attempts signInWithPassword at all — requireAppUser would
 * just sign it straight back out (lib/auth/session.ts) and redirect
 * to a dead end. Setting a PIN is still allowed so there's no second
 * visit needed once approved; logging in isn't, so that path shows
 * the waiting state instead of the PIN form.
 */
export function DriverPinFlow({
  id,
  fullName,
  email,
  needsSetup,
  pendingApproval,
  hasPasskey = false,
}: {
  id: string;
  fullName: string;
  email: string;
  needsSetup: boolean;
  pendingApproval: boolean;
  /** Skips straight to a "Déverrouiller" button above the PIN form — see app/api/auth/passkey. */
  hasPasskey?: boolean;
}) {
  const supabase = createBrowserSupabaseClient();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinJustCreated, setPinJustCreated] = useState(false);

  async function unlockWithPasskey() {
    setBusy(true);
    setError(null);
    try {
      const { attempted } = await tryPasskeyLogin({ user_id: id });
      if (attempted) {
        window.location.href = "/dashboard";
        return;
      }
      setBusy(false);
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "NotAllowedError") {
        setError(e instanceof Error ? e.message : "Erreur inattendue");
      }
      setBusy(false);
    }
  }

  async function signIn(withPin: string) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: withPin });
    if (signInError) throw new Error("Code PIN incorrect.");
    window.location.href = "/dashboard";
  }

  async function submitSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/driver-pin/${id}/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, confirmPin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      if (pendingApproval) {
        setPinJustCreated(true);
        setBusy(false);
      } else {
        await signIn(pin);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(pin);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  if (pendingApproval && (pinJustCreated || !needsSetup)) {
    return (
      <Card className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div>
          <h1 className="text-2xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h1>
          <p className="mt-1 text-sm text-navy/65">
            {pinJustCreated ? "Votre code est créé. " : ""}Votre compte doit encore être validé par un responsable avant que
            vous puissiez vous connecter — vous serez prévenu.
          </p>
        </div>
        <QrCodeBadge type="driver" id={id} title={fullName} subtitle="Badge de connexion — à conserver" />
      </Card>
    );
  }

  if (needsSetup) {
    return (
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <div>
          <h1 className="text-2xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h1>
          <p className="mt-1 text-sm text-navy/65">
            Première connexion : créez votre code PIN (4 à 6 chiffres). Vous le ressaisirez à chaque connexion.
          </p>
        </div>
        <form onSubmit={submitSetup} className="flex flex-col gap-3">
          <div>
            <label className="block"><span className="label">Code PIN</span>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
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
              required
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
            /></label>
          </div>
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || !pin || !confirmPin}>
            {busy ? "Création…" : pendingApproval ? "Créer mon code" : "Créer mon code et me connecter"}
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="flex w-full max-w-sm flex-col gap-4">
      <div>
        <h1 className="text-2xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h1>
        <p className="mt-1 text-sm text-navy/65">Entrez votre code PIN pour vous connecter.</p>
      </div>
      {hasPasskey && (
        <>
          <button type="button" className="btn-primary" disabled={busy} onClick={unlockWithPasskey}>
            {busy ? "Vérification…" : "Face ID / empreinte"}
          </button>
          <div className="flex items-center gap-2 text-xs text-navy/60">
            <div className="h-px flex-1 bg-navy/10" />
            ou
            <div className="h-px flex-1 bg-navy/10" />
          </div>
        </>
      )}
      <form onSubmit={submitLogin} className="flex flex-col gap-3">
        <div>
          <label className="block"><span className="label">Code PIN</span>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          /></label>
        </div>
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy || !pin}>
          {busy ? "Connexion…" : "Me connecter"}
        </button>
      </form>
    </Card>
  );
}
