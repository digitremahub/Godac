"use client";

import { useState } from "react";

type Driver = { id: string; full_name: string; phone: string | null };

const RESET_CONFIRMATION = "REINITIALISER LES ACCES";

export function DriverRecoveryCodePanel({ drivers }: { drivers: Driver[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ id: string; name: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [showResetConfirmation, setShowResetConfirmation] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [activationCodes, setActivationCodes] = useState<{ driverId: string; fullName: string; code: string }[]>([]);

  async function generate(driver: Driver) {
    const confirmed = window.confirm(`Générer un nouveau code de secours pour ${driver.full_name} ? L'ancien code sera immédiatement invalidé.`);
    if (!confirmed) return;
    setLoadingId(driver.id);
    setError(null);
    setGenerated(null);
    setCopied(false);
    try {
      const response = await fetch(`/api/admin/drivers/${driver.id}/recovery-code`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.recoveryCode) throw new Error(payload.error ?? "Impossible de générer le code de secours.");
      setGenerated({ id: driver.id, name: driver.full_name, code: payload.recoveryCode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      setLoadingId(null);
    }
  }

  async function resetAllAccess() {
    if (confirmation !== RESET_CONFIRMATION) {
      setError(`Saisissez exactement : ${RESET_CONFIRMATION}`);
      return;
    }
    setResettingAll(true);
    setError(null);
    setResetMessage(null);
    try {
      const response = await fetch("/api/admin/drivers/reset-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const payload = await response.json().catch(() => ({}));
      if (Array.isArray(payload.activationCodes)) setActivationCodes(payload.activationCodes);
      if (!response.ok || payload.ok !== true) {
        if (payload.failedCount > 0) {
          throw new Error(`${payload.message ?? "Réinitialisation partielle."} ${payload.resetCount ?? 0} entièrement traité(s), ${payload.failedCount} en échec. Identifiants concernés : ${(payload.failures ?? []).map((item: { driverId: string; step: string }) => `${item.driverId} (${item.step})`).join(", ")}`);
        }
        throw new Error(payload.error ?? payload.message ?? "Impossible de réinitialiser les accès.");
      }
      setResetMessage(`Accès réinitialisés pour ${payload.resetCount} chauffeur(s). Les comptes et historiques sont conservés.`);
      setShowResetConfirmation(false);
      setConfirmation("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      setResettingAll(false);
    }
  }

  async function copyCode() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.code);
      setCopied(true);
    } catch {
      setError("Copie automatique impossible. Sélectionnez le code et copiez-le manuellement.");
    }
  }

  if (drivers.length === 0) return null;

  return (
    <section className="mb-6 rounded-2xl border border-navy/10 bg-white p-5">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Accès chauffeurs</h2>
        <p className="mt-1 text-sm text-navy/60">Générer un nouveau code de secours pour un chauffeur qui a perdu le sien. Le code précédent sera invalidé. Le code s'affiche une seule fois : transmettez-le au chauffeur de manière confidentielle.</p>
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {resetMessage && <p role="status" className="mb-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">{resetMessage}</p>}
      <div className="mb-4 rounded-xl border border-orange-300 bg-orange-50 p-3">
        <p className="text-sm text-orange-950">La réinitialisation révoque les clés biométriques et les codes de connexion des chauffeurs, mais conserve leurs comptes et l’historique des tournées. Chaque chauffeur devra réenregistrer son accès avec le code d’activation affiché ici. Cette opération peut interrompre leur connexion.</p>
        {!showResetConfirmation ? (
          <button type="button" disabled={resettingAll} onClick={() => { setError(null); setShowResetConfirmation(true); }} className="mt-3 rounded-lg border border-orange-500 px-3 py-2 text-sm font-semibold text-orange-950 disabled:opacity-50">Préparer la réinitialisation globale</button>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm font-semibold text-orange-950">Pour confirmer, saisis exactement : <span className="font-mono">{RESET_CONFIRMATION}</span></p>
            <input aria-label="Phrase de confirmation de réinitialisation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="w-full rounded-lg border border-orange-400 bg-white px-3 py-2 text-sm" />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={resettingAll || confirmation !== RESET_CONFIRMATION} onClick={resetAllAccess} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{resettingAll ? "Réinitialisation…" : "Confirmer la réinitialisation"}</button>
              <button type="button" disabled={resettingAll} onClick={() => { setShowResetConfirmation(false); setConfirmation(""); }} className="rounded-lg border border-navy/20 px-3 py-2 text-sm">Annuler</button>
            </div>
          </div>
        )}
      </div>
      {activationCodes.length > 0 && (
        <div className="mb-4 rounded-xl border border-teal-600/30 bg-teal-50 p-4">
          <p className="text-sm font-medium">Codes d&apos;activation (affichés une seule fois, valables 7 jours)</p>
          <p className="mt-1 text-xs text-navy/60">Remettez à chaque chauffeur son code de manière confidentielle : il le saisira avec son nouveau PIN après avoir scanné son badge.</p>
          <ul className="mt-3 divide-y divide-teal-600/20">
            {activationCodes.map((item) => (
              <li key={item.driverId} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm">{item.fullName}</span>
                <span className="select-all font-mono font-bold tracking-wider">{item.code}</span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setActivationCodes([])} className="mt-3 rounded-lg border border-navy/15 px-3 py-2 text-sm">Masquer les codes</button>
        </div>
      )}
      {generated && (
        <div className="mb-4 rounded-xl border border-teal-600/30 bg-teal-50 p-4">
          <p className="text-sm font-medium">Nouveau code de secours — {generated.name}</p>
          <p className="my-3 break-all font-mono text-xl font-bold tracking-wider">{generated.code}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={copyCode} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white">{copied ? "Code copié" : "Copier le code"}</button>
            <button type="button" onClick={() => { setGenerated(null); setCopied(false); }} className="rounded-lg border border-navy/15 px-3 py-2 text-sm">Masquer le code</button>
          </div>
          <p className="mt-2 text-xs text-navy/60">Ne fermez pas cette fenêtre avant d'avoir transmis le code au chauffeur.</p>
        </div>
      )}
      <ul className="divide-y divide-navy/10">
        {drivers.map((driver) => (
          <li key={driver.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-medium">{driver.full_name}</p>{driver.phone && <p className="text-sm text-navy/60">{driver.phone}</p>}</div>
            <button type="button" disabled={loadingId !== null || resettingAll} onClick={() => generate(driver)} className="rounded-lg border border-teal-700 px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50">{loadingId === driver.id ? "Génération…" : "Renvoyer un code"}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
