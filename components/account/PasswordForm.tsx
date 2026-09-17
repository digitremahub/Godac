"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/**
 * Lets a magic-link-only user set a password on their own account, so
 * future sign-ins don't require email access every time (see
 * components/auth/AuthForm.tsx's password option). Supabase treats
 * this as a normal profile update on the already-authenticated
 * session — no current password needed, unlike a typical "change
 * password" flow.
 */
export function PasswordForm() {
  const supabase = createBrowserSupabaseClient();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      setBusy(false);
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      setBusy(false);
      return;
    }
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSaved(true);
      setPassword("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-md flex-col gap-4">
      <div>
        <h3 className="text-lg">Mot de passe</h3>
        <p className="mt-1 text-sm text-navy/50">
          Optionnel — vous pouvez toujours vous connecter par lien magique. Définir un mot de
          passe permet aussi de vous connecter sans avoir accès à votre boîte mail.
        </p>
      </div>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {saved && <p className="text-sm text-teal-ink">Mot de passe enregistré.</p>}
      <div>
        <label className="label">Nouveau mot de passe</label>
        <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <label className="label">Confirmer le mot de passe</label>
        <input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <button className="btn-primary self-start" disabled={busy || !password || !confirm} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer le mot de passe"}
      </button>
    </Card>
  );
}
