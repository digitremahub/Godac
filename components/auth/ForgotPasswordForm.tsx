"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/**
 * Standard Supabase password-recovery request: emails a one-time
 * link that lands on /auth/confirm (already generic — it just
 * verifies whatever token_hash it's given) and continues to
 * /account, where PasswordForm lets the now-authenticated user set a
 * new password.
 */
export function ForgotPasswordForm() {
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
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/account`,
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
          Si un compte existe pour <span className="text-navy">{email}</span>, un lien de
          réinitialisation vient de lui être envoyé.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card flex w-full flex-col gap-5 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
      <div>
        <h1 className="text-2xl sm:text-[28px]">Mot de passe oublié</h1>
        <p className="mt-1 text-sm text-navy/65">
          On vous envoie un lien pour choisir un nouveau mot de passe.
        </p>
      </div>
      <div>
        <label className="block"><span className="label">E-mail professionnel</span>
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
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      <button type="submit" className="btn-primary" disabled={busy || !email}>
        {busy ? "Envoi…" : "Recevoir le lien de réinitialisation"}
      </button>
    </form>
  );
}
