"use client";

import { useState } from "react";

type Driver = { id: string; full_name: string; phone: string | null };

export function DriverRecoveryCodePanel({ drivers }: { drivers: Driver[] }) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ id: string; name: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate(driver: Driver) {
    const confirmed = window.confirm(
      `Générer un nouveau code de secours pour ${driver.full_name} ? L'ancien code sera immédiatement invalidé.`,
    );
    if (!confirmed) return;

    setLoadingId(driver.id);
    setError(null);
    setGenerated(null);
    setCopied(false);
    try {
      const response = await fetch(`/api/admin/drivers/${driver.id}/recovery-code`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.recoveryCode) {
        throw new Error(payload.error ?? "Impossible de générer le code de secours.");
      }
      setGenerated({ id: driver.id, name: driver.full_name, code: payload.recoveryCode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Une erreur est survenue.");
    } finally {
      setLoadingId(null);
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
        <p className="mt-1 text-sm text-navy/60">
          Générer un nouveau code de secours pour un chauffeur qui a perdu le sien. Le code précédent sera invalidé.
          Le code s'affiche une seule fois : transmettez-le au chauffeur de manière confidentielle.
        </p>
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {generated && (
        <div className="mb-4 rounded-xl border border-teal-600/30 bg-teal-50 p-4">
          <p className="text-sm font-medium">Nouveau code de secours — {generated.name}</p>
          <p className="my-3 break-all font-mono text-xl font-bold tracking-wider">{generated.code}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={copyCode} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white">
              {copied ? "Code copié" : "Copier le code"}
            </button>
            <button type="button" onClick={() => { setGenerated(null); setCopied(false); }} className="rounded-lg border border-navy/15 px-3 py-2 text-sm">
              Masquer le code
            </button>
          </div>
          <p className="mt-2 text-xs text-navy/60">Ne fermez pas cette fenêtre avant d'avoir transmis le code au chauffeur.</p>
        </div>
      )}

      <ul className="divide-y divide-navy/10">
        {drivers.map((driver) => (
          <li key={driver.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{driver.full_name}</p>
              {driver.phone && <p className="text-sm text-navy/60">{driver.phone}</p>}
            </div>
            <button
              type="button"
              disabled={loadingId !== null}
              onClick={() => generate(driver)}
              className="rounded-lg border border-teal-700 px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingId === driver.id ? "Génération…" : "Renvoyer un code"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
