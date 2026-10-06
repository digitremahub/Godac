"use client";

import Link from "next/link";
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { tryPasskeyLogin } from "@/lib/auth/passkey-login";

/**
 * Sign-up (and a first sign-in) is always magic link / OTP — Supabase
 * creates the account on first use, so there's nothing to set a
 * password against yet. Once signed in, a user can set a password
 * from /account (components/account/PasswordForm.tsx); after that,
 * sign-in offers a password shortcut alongside the magic link so they
 * don't need email access every time.
 */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const supabase = createBrowserSupabaseClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyUnavailable, setPasskeyUnavailable] = useState(false);

  async function usePasskey() {
    setPasskeyBusy(true);
    setError(null);
    setPasskeyUnavailable(false);
    try {
      const { attempted } = await tryPasskeyLogin({ email });
      if (attempted) {
        window.location.href = "/dashboard";
        return;
      }
      setPasskeyUnavailable(true);
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "NotAllowedError") {
        setError(e instanceof Error ? e.message : "Erreur inattendue");
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (usePassword) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = "/dashboard";
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          // Only meaningful on sign-up (a returning user's metadata is
          // already set) — this is what
          // app/api/onboarding/create-organization/route.ts and
          // lib/auth/provisioning.ts read as the profile's full_name;
          // without it, both silently fell back to the email address.
          ...(mode === "sign-up" && fullName ? { data: { full_name: fullName } } : {}),
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card max-w-sm text-center">
        <p className="text-lg">📩 Vérifiez votre boîte mail</p>
        <p className="mt-2 text-sm text-navy/60">
          Un lien de connexion a été envoyé à <span className="text-navy">{email}</span>.
          Cliquez dessus pour {mode === "sign-in" ? "vous connecter" : "créer votre compte"}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card flex w-full max-w-sm flex-col gap-4">
      <div>
        <h2 className="text-xl">{mode === "sign-in" ? "Connexion" : "Créer votre compte"}</h2>
        <p className="mt-1 text-sm text-navy/50">
          {usePassword
            ? "Connectez-vous avec le mot de passe défini depuis votre compte."
            : "Pas de mot de passe — on vous envoie un lien de connexion par email."}
        </p>
      </div>
      {mode === "sign-up" && (
        <div>
          <label className="label">Nom et prénom</label>
          <input
            type="text"
            required
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jean Dupont"
          />
        </div>
      )}
      <div>
        <label className="label">Email professionnel</label>
        <input
          type="email"
          required
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vous@entreprise.fr"
        />
      </div>
      {mode === "sign-in" && usePassword && (
        <div>
          <label className="label">Mot de passe</label>
          <input
            type="password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {passkeyUnavailable && (
        <p className="text-xs text-navy/40">Aucune clé Face ID / empreinte enregistrée pour cet email sur cet appareil.</p>
      )}
      <button
        type="submit"
        className="btn-primary"
        disabled={busy || !email || (usePassword && !password) || (mode === "sign-up" && !fullName)}
      >
        {busy ? "Connexion…" : usePassword ? "Se connecter" : "Recevoir le lien de connexion"}
      </button>
      {mode === "sign-in" && (
        <button type="button" className="btn-secondary" disabled={passkeyBusy || !email} onClick={usePasskey}>
          {passkeyBusy ? "…" : "🔓 Face ID / empreinte"}
        </button>
      )}
      {mode === "sign-in" && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-navy/50 hover:text-navy hover:underline"
            onClick={() => setUsePassword((v) => !v)}
          >
            {usePassword ? "Utiliser le lien magique à la place" : "Se connecter avec un mot de passe"}
          </button>
          {usePassword && (
            <Link href="/forgot-password" className="text-sm text-navy/50 hover:text-navy hover:underline">
              Mot de passe oublié ?
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
