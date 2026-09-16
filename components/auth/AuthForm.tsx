"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/**
 * Passwordless auth (magic link / OTP email) for both sign-in and
 * sign-up — Supabase creates the account on first use, so there is no
 * separate password to set, confirm, or ever reset. Sign-in and
 * sign-up are the exact same action; only the on-screen copy differs.
 */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const supabase = createBrowserSupabaseClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
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
        <p className="mt-2 text-sm text-white/60">
          Un lien de connexion a été envoyé à <span className="text-white">{email}</span>.
          Cliquez dessus pour {mode === "sign-in" ? "vous connecter" : "créer votre compte"}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card flex w-full max-w-sm flex-col gap-4">
      <div>
        <h2 className="text-xl">{mode === "sign-in" ? "Connexion" : "Créer votre compte"}</h2>
        <p className="mt-1 text-sm text-white/50">
          Pas de mot de passe — on vous envoie un lien de connexion par email.
        </p>
      </div>
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
      {error && <p className="text-sm text-orange">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy || !email}>
        {busy ? "Envoi…" : "Recevoir le lien de connexion"}
      </button>
    </form>
  );
}
