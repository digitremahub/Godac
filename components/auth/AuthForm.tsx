"use client";

import Link from "next/link";
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { tryPasskeyLogin } from "@/lib/auth/passkey-login";
import { expliquerErreurPasskey } from "@/lib/auth/passkey-erreurs";
import { IconFingerprint } from "@/components/layout/icons";
import { postLoginPath } from "@/lib/auth/post-login";

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
  const [driverPin, setDriverPin] = useState("");
  const [driverPinMode, setDriverPinMode] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyUnavailable, setPasskeyUnavailable] = useState(false);
  const [passkeyError, setPasskeyError] = useState<{ code: string; message: string } | null>(null);

  /** Sans e-mail : clé « découvrable ». Avec e-mail : clés de ce compte (anciennes clés). */
  async function usePasskey(avecEmail: boolean) {
    setPasskeyBusy(true);
    setError(null);
    setPasskeyError(null);
    setPasskeyUnavailable(false);
    try {
      const { attempted } = await tryPasskeyLogin(avecEmail ? { email } : {});
      if (attempted) {
        window.location.href = postLoginPath();
        return;
      }
      setPasskeyUnavailable(true);
    } catch (e) {
      setPasskeyError(expliquerErreurPasskey(e, { avecEmail }));
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (driverPinMode) {
        const res = await fetch("/api/auth/driver-pin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, pin: driverPin }) });
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Erreur de connexion (${res.status}).`);
        window.location.href = postLoginPath();
        return;
      }
      if (usePassword) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = postLoginPath();
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}${postLoginPath()}`,
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
      <div className="card text-center">
        <p className="font-display text-lg font-bold">Vérifiez votre boîte mail</p>
        <p className="mt-2 text-sm text-navy/70">
          Un lien de connexion a été envoyé à <span className="text-navy">{email}</span>.
          Cliquez dessus pour {mode === "sign-in" ? "vous connecter" : "créer votre compte"}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card flex w-full flex-col gap-5 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
      <div>
        <h1 className="text-2xl sm:text-[28px]">{mode === "sign-in" ? "Connexion" : "Créer votre compte"}</h1>
        <p className="mt-2 text-sm text-navy/65 sm:text-[15px]">
          {driverPinMode
            ? "Les anciens comptes chauffeur peuvent se connecter avec leur e-mail et leur PIN, sans scanner le badge."
            : usePassword
              ? "Connectez-vous avec le mot de passe défini depuis votre compte."
              : "Pas de mot de passe — on vous envoie un lien de connexion par email."}
        </p>
      </div>
      {mode === "sign-up" && (
        <div>
          <label className="block"><span className="label">Nom et prénom</span>
          <input
            type="text"
            name="name"
            autoComplete="name"
            required
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jean Dupont"
          /></label>
        </div>
      )}
      <div>
        <label className="block"><span className="label">Email professionnel</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          spellCheck={false}
          required
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vous@entreprise.fr"
        /></label>
      </div>
      {mode === "sign-in" && driverPinMode && (
        <div><label className="block"><span className="label">Code PIN chauffeur</span><input type="password" inputMode="numeric" autoComplete="current-password" required className="input" value={driverPin} onChange={(e) => setDriverPin(e.target.value)} placeholder="Votre PIN" /></label></div>
      )}
      {mode === "sign-in" && usePassword && !driverPinMode && (
        <div>
          <label className="block"><span className="label">Mot de passe</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          /></label>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {passkeyError && (
        <p role="alert" className="text-sm text-orange-ink">
          {passkeyError.message} <span className="whitespace-nowrap text-xs text-navy/60">Code : {passkeyError.code}</span>
        </p>
      )}
      {passkeyUnavailable && (
        <p className="text-xs text-navy/60">
          Aucune clé Face ID / empreinte enregistrée pour cette adresse. Vérifiez l&apos;e-mail, ou utilisez « Se connecter avec Face ID / empreinte » sans e-mail.
        </p>
      )}
      <button
        type="submit"
        className="btn-primary"
        disabled={busy || !email || (driverPinMode ? !driverPin : usePassword && !password) || (mode === "sign-up" && !fullName)}
      >
        {busy ? "Connexion…" : driverPinMode || usePassword ? "Se connecter" : "Recevoir le lien de connexion"}
      </button>
      {mode === "sign-in" && (
        <button type="button" className="btn-secondary" disabled={passkeyBusy || driverPinMode} onClick={() => usePasskey(false)}>
          <IconFingerprint className="h-[18px] w-[18px]" />
          {passkeyBusy ? "Vérification…" : "Se connecter avec Face ID / empreinte"}
        </button>
      )}
      {mode === "sign-in" && email && !driverPinMode && (
        <button type="button" className="text-sm text-navy/65 hover:text-navy hover:underline" disabled={passkeyBusy} onClick={() => usePasskey(true)}>
          Face ID / empreinte avec cette adresse e-mail (clé ancienne)
        </button>
      )}
      {mode === "sign-in" && (
        <p className="text-xs text-navy/60">
          Chauffeur sans adresse e-mail ? Scannez le QR code de votre badge pour ouvrir la connexion chauffeur par PIN ou biométrie.
        </p>
      )}
      {mode === "sign-in" && (
        <button type="button" className="text-sm text-navy/65 hover:text-navy hover:underline" onClick={() => { setDriverPinMode((v) => !v); setUsePassword(false); setDriverPin(""); setError(null); }}>
          {driverPinMode ? "Autre méthode de connexion" : "Ancien compte chauffeur ? E-mail + PIN"}
        </button>
      )}
      {mode === "sign-in" && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm text-navy/65 hover:text-navy hover:underline"
            onClick={() => { setUsePassword((v) => !v); setDriverPinMode(false); setError(null); }}
          >
            {usePassword ? "Utiliser le lien magique à la place" : "Se connecter avec un mot de passe"}
          </button>
          {usePassword && (
            <Link href="/forgot-password" className="text-sm text-navy/65 hover:text-navy hover:underline">
              Mot de passe oublié ?
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
