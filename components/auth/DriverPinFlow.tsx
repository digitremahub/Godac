"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";

/**
 * The two faces of the same badge scan: a driver who has never set a
 * PIN gets "créez votre code", one who already has gets "entrez votre
 * code". Both end the same way — a real Supabase Auth session via
 * signInWithPassword, exactly like AuthForm.tsx's password path, just
 * with a PIN playing the password's role.
 */
export function DriverPinFlow({
  id,
  fullName,
  email,
  needsSetup,
}: {
  id: string;
  fullName: string;
  email: string;
  needsSetup: boolean;
}) {
  const supabase = createBrowserSupabaseClient();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await signIn(pin);
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
            {busy ? "Création…" : "Créer mon code et me connecter"}
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
