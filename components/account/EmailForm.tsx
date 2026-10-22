"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/**
 * Supabase sends a confirmation link to the new address (and, if
 * "secure email change" is on, another to the old one) before the
 * change actually takes effect — auth.users.email only updates once
 * that link is clicked. public.users.email (what the rest of the app
 * reads, e.g. AccountPage) gets re-synced from the confirmed session
 * in app/auth/callback/route.ts, the same link the confirmation click
 * lands on.
 */
export function EmailForm({ currentEmail }: { currentEmail: string }) {
  const supabase = createBrowserSupabaseClient();
  const [email, setEmail] = useState(currentEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const { error } = await supabase.auth.updateUser(
        { email },
        { emailRedirectTo: `${window.location.origin}/account` },
      );
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-md flex-col gap-4">
      <div>
        <h3 className="text-lg">Adresse email</h3>
        <p className="mt-1 text-sm text-navy/65">
          Un email de confirmation sera envoyé à la nouvelle adresse — le changement ne prend
          effet qu&apos;après avoir cliqué le lien qu&apos;il contient.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {sent && <p role="status" className="text-sm text-teal-ink">E-mail de confirmation envoyé à {email}.</p>}
      <div>
        <label className="block"><span className="label">Nouvelle adresse</span>
        <input type="email" name="email" autoComplete="email" spellCheck={false} className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
      <button
        className="btn-primary self-start"
        disabled={busy || !email || email === currentEmail}
        onClick={save}
      >
        {busy ? "Envoi…" : "Changer l'email"}
      </button>
    </Card>
  );
}
