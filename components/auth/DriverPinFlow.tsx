"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { tryPasskeyLogin } from "@/lib/auth/passkey-login";
import { expliquerErreurPasskey } from "@/lib/auth/passkey-erreurs";
import { Card } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { postLoginPath } from "@/lib/auth/post-login";

export function DriverPinFlow({
  id, fullName, needsSetup, pendingApproval, hasPasskey = false, needsActivation = false,
}: {
  id: string; fullName: string; needsSetup: boolean; pendingApproval: boolean; hasPasskey?: boolean;
  /** Accès réinitialisé par l'encadrement : code d'activation exigé pour créer le PIN. */
  needsActivation?: boolean;
}) {
  const supabase = createBrowserSupabaseClient();
  const [pin, setPin] = useState("");
  const [showFallback, setShowFallback] = useState(false);
  const [confirmPin, setConfirmPin] = useState("");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [activationCode, setActivationCode] = useState("");
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
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, confirmPin, ...(activationCode.trim() ? { activationCode: activationCode.trim() } : {}) }),
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
      const { message, code } = expliquerErreurPasskey(e, { secours: "votre PIN" });
      setError(`${message} (code : ${code})`);
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
          {needsActivation && (
            <label className="block"><span className="label">Code d&apos;activation remis par votre responsable</span><input className="input font-mono uppercase" autoComplete="off" required value={activationCode} onChange={e => setActivationCode(e.target.value)} placeholder="ABCD-EFGH" /></label>
          )}
          <label className="block"><span className="label">Code PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="off" required value={pin} onChange={e => setPin(e.target.value)} /></label>
          <label className="block"><span className="label">Confirmez le code PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="off" required value={confirmPin} onChange={e => setConfirmPin(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy || !pin || !confirmPin || (needsActivation && !activationCode.trim())}>{busy ? "Création…" : "Créer mon PIN et mon code de secours"}</button>
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
      <div>
        <h1 className="text-2xl">Bonjour {fullName.split(" ")[0] ?? fullName}</h1>
        <p className="mt-1 text-sm text-navy/65">Connectez-vous en un geste avec la biométrie de votre téléphone. Votre badge QR reste votre identifiant chauffeur.</p>
      </div>
      {hasPasskey ? (
        <button type="button" className="btn-primary min-h-14 text-base" disabled={busy} onClick={unlockWithPasskey}>
          {busy ? "Vérification biométrique…" : "Se connecter avec Face ID / empreinte"}
        </button>
      ) : (
        <div className="rounded-xl border border-teal/20 bg-teal/5 p-3 text-sm text-navy/75">
          Face ID / empreinte n’est pas encore associé à ce compte sur cet appareil. Utilisez la méthode de secours ci-dessous, puis associez la biométrie depuis les paramètres de connexion.
        </div>
      )}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      <button type="button" className="btn-secondary" onClick={() => { setShowFallback(v => !v); setError(null); }}>
        {showFallback ? "Masquer les autres options" : "Autre méthode de connexion"}
      </button>
      {showFallback && (
        <form onSubmit={submitLogin} className="flex flex-col gap-3">
          <label className="block"><span className="label">Code PIN chauffeur</span><input className="input" type="password" inputMode="numeric" autoComplete="off" required value={pin} onChange={e => setPin(e.target.value)} /></label>
          <button type="submit" className="btn-primary" disabled={busy || !pin}>{busy ? "Connexion…" : "Me connecter avec mon PIN"}</button>
          <button type="button" className="text-sm text-navy/65 hover:underline" onClick={() => { setRecoveryMode(true); setPin(""); setConfirmPin(""); setError(null); }}>PIN oublié ? Utiliser mon code de secours</button>
        </form>
      )}
    </Card>
  );
}
