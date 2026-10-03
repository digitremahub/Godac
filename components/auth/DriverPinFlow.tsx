"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
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
}: {
  id: string;
  fullName: string;
  email: string;
  needsSetup: boolean;
  pendingApproval: boolean;
}) {
  const supabase = createBrowserSupabaseClient();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinJustCreated, setPinJustCreated] = useState(false);

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
          <h2 className="text-xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h2>
          <p className="mt-1 text-sm text-navy/50">
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
          <h2 className="text-xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h2>
          <p className="mt-1 text-sm text-navy/50">
            Première connexion : créez votre code PIN (4 à 6 chiffres). Vous le ressaisirez à chaque connexion.
          </p>
        </div>
        <form onSubmit={submitSetup} className="flex flex-col gap-3">
          <div>
            <label className="label">Code PIN</label>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Confirmez le code PIN</label>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              required
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-orange-ink">{error}</p>}
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
        <h2 className="text-xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h2>
        <p className="mt-1 text-sm text-navy/50">Entrez votre code PIN pour vous connecter.</p>
      </div>
      <form onSubmit={submitLogin} className="flex flex-col gap-3">
        <div>
          <label className="label">Code PIN</label>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            required
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-orange-ink">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy || !pin}>
          {busy ? "Connexion…" : "Me connecter"}
        </button>
      </form>
    </Card>
  );
}
