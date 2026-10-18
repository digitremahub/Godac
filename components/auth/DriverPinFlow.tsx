"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { tryPasskeyLogin } from "@/lib/auth/passkey-login";
import { Card } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { postLoginPath } from "@/lib/auth/post-login";

export function DriverPinFlow({
  id, fullName, needsSetup, pendingApproval, hasPasskey = false,
}: {
  id: string; fullName: string; needsSetup: boolean; pendingApproval: boolean; hasPasskey?: boolean;
}) {
  const supabase = createBrowserSupabaseClient();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCodeToSave, setRecoveryCodeToSave] = useState<string | null>(null);
  const [recoveryDone, setRecoveryDone] = useState(false);

  async function readResponse(res: Response) {
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : `Erreur serveur (${res.status}). Réessayez.`);
    return json;
  }

  async function signIn(withPin: string) {
    const res = await fetch(`/api/auth/driver-pin/${id}/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: withPin }),
    });
    await readResponse(res);
    window.location.href = postLoginPath();
  }

  async function submitSetup(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/auth/driver-pin/${id}/set`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, confirmPin }),
      });
      const json = await readResponse(res);
      if (typeof json?.recoveryCode !== "string") throw new Error("Le code de secours n'a pas été généré. Réessayez.");
      setRecoveryCodeToSave(json.recoveryCode);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur inattendue"); }
    finally { setBusy(false); }
  }

  async function submitRecovery(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/auth/driver-pin/${id}/recover`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recoveryCode: recoveryCodeInput, pin, confirmPin }),
      });
      const json = await readResponse(res);
      if (typeof json?.recoveryCode !== "string") throw new Error("Le nouveau code de secours n'a pas été généré.");
      setRecoveryCodeToSave(json.recoveryCode);
      setRecoveryDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur inattendue"); }
    finally { setBusy(false); }
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await signIn(pin); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur inattendue"); setBusy(false); }
  }

  async function unlockWithPasskey() {
    setBusy(true); setError(null);
    try {
      const { attempted } = await tryPasskeyLogin({ user_id: id });
      if (attempted) { window.location.href = postLoginPath(); return; }
      setError("Aucune clé biométrique n'est enregistrée pour ce compte. Utilisez votre PIN.");
    } catch (e) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setError("La demande Face ID / empreinte a été annulée, a expiré ou n’a pas abouti. Réessayez en validant la demande biométrique, ou utilisez votre PIN.");
      } else {
        setError(e instanceof Error ? e.message : "Connexion biométrique impossible. Utilisez votre PIN.");
      }
    } finally { setBusy(false); }
  }

  if (recoveryCodeToSave) {
    return (
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <div>
          <h1 className="text-xl">Conservez votre code de secours</h1>
          <p className="mt-2 text-sm text-navy/70">Ce code ne sera plus affiché. Notez-le et conservez-le hors de votre téléphone. Il permet de réinitialiser votre PIN et sera renouvelé à chaque récupération.</p>
        </div>
        <div className="rounded-lg border border-navy/15 bg-navy/5 p-4 text-center font-mono text-lg font-bold tracking-wider select-all">{recoveryCodeToSave}</div>
        <button type="button" className="btn-primary" onClick={async () => {
          setRecoveryCodeToSave(null);
          if (pendingApproval) { setRecoveryDone(true); return; }
          setBusy(true);
          try { await signIn(pin); } catch (e) { setError(e instanceof Error ? e.message : "Connexion impossible"); setBusy(false); }
        }} disabled={busy}>
          {busy ? "Connexion…" : "J'ai sauvegardé mon code"}
        </button>
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      </Card>
    );
  }

  if (pendingApproval && (recoveryDone || (!needsSetup && !recoveryMode))) {
    return (
      <Card className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div><h1 className="text-2xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h1><p className="mt-1 text-sm text-navy/65">Votre compte doit être validé par un responsable avant la connexion. Vous serez prévenu.</p></div>
        <QrCodeBadge type="driver" id={id} title={fullName} subtitle="Badge de connexion — à conserver" />
      </Card>
    );
  }

  if (needsSetup && !recoveryMode) {
    return (
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <div><h1 className="text-2xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h1><p className="mt-1 text-sm text-navy/65">Première connexion : créez votre PIN de 4 à 6 chiffres. Un code de secours obligatoire sera généré ensuite.</p></div>
        <form onSubmit={submitSetup} className="flex flex-col gap-3">
          <label className="block"><span className="label">Code PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="off" required value={pin} onChange={e => setPin(e.target.value)} /></label>
          <label className="block"><span className="label">Confirmez le code PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="off" required value={confirmPin} onChange={e => setConfirmPin(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || !pin || !confirmPin}>{busy ? "Création…" : "Créer mon PIN et mon code de secours"}</button>
        </form>
      </Card>
    );
  }

  if (recoveryMode) {
    return (
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <div><h1 className="text-xl">Récupérer mon compte</h1><p className="mt-1 text-sm text-navy/65">Saisissez votre code de secours puis choisissez un nouveau PIN. L'ancien code sera invalidé.</p></div>
        <form onSubmit={submitRecovery} className="flex flex-col gap-3">
          <label className="block"><span className="label">Code de secours</span><input className="input" autoComplete="off" required value={recoveryCodeInput} onChange={e => setRecoveryCodeInput(e.target.value)} /></label>
          <label className="block"><span className="label">Nouveau PIN (4 à 6 chiffres)</span><input className="input" type="password" inputMode="numeric" autoComplete="off" required value={pin} onChange={e => setPin(e.target.value)} /></label>
          <label className="block"><span className="label">Confirmez le nouveau PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="off" required value={confirmPin} onChange={e => setConfirmPin(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || !recoveryCodeInput || !pin || !confirmPin}>{busy ? "Récupération…" : "Réinitialiser le PIN"}</button>
          <button type="button" className="btn-secondary" onClick={() => { setRecoveryMode(false); setError(null); }}>Retour à la connexion</button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="flex w-full max-w-sm flex-col gap-4">
      <div><h1 className="text-2xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h1><p className="mt-1 text-sm text-navy/65">Votre badge identifie votre compte. Utilisez la biométrie sur un appareil déjà associé ou votre PIN.</p></div>
      {hasPasskey && <button type="button" className="btn-primary" disabled={busy} onClick={unlockWithPasskey}>{busy ? "Vérification…" : "Face ID / empreinte sur cet appareil"}</button>}
      {hasPasskey && <div className="text-center text-xs text-navy/60">ou utilisez votre PIN</div>}
      <form onSubmit={submitLogin} className="flex flex-col gap-3">
        <label className="block"><span className="label">Code PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="off" required autoFocus value={pin} onChange={e => setPin(e.target.value)} /></label>
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy || !pin}>{busy ? "Connexion…" : "Me connecter"}</button>
        <button type="button" className="text-sm text-navy/65 hover:underline" onClick={() => { setRecoveryMode(true); setPin(""); setConfirmPin(""); setError(null); }}>PIN oublié ? Utiliser mon code de secours</button>
      </form>
    </Card>
  );
}
