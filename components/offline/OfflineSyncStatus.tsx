"use client";
import { useCallback, useEffect, useState } from "react";
import { flushOfflineMutations, listOfflineFiles, listOfflineMutations, OFFLINE_QUEUE_EVENT } from "@/lib/offline/outbox";

export function OfflineSyncStatus() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [pendingFiles, setPendingFiles] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setOnline(navigator.onLine);
    try {
      const [items, files] = await Promise.all([listOfflineMutations(), listOfflineFiles()]);
      setPending(items.length);
      setPendingFiles(files.length);
      setError(items.find((x) => x.lastError)?.lastError ?? null);
    } catch {
      setError("Le stockage hors ligne n'est pas disponible sur cet appareil.");
    }
  }, []);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return refresh();
    setSyncing(true);
    try {
      const result = await flushOfflineMutations();
      setPending(result.pending);
      setError(result.error ?? null);
      if (result.synced > 0 && result.pending === 0) window.dispatchEvent(new Event("godac:offline-synced"));
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const onlineHandler = () => { void sync(); };
    const changeHandler = () => { void refresh(); };
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", changeHandler);
    window.addEventListener(OFFLINE_QUEUE_EVENT, changeHandler);
    const interval = window.setInterval(() => { if (navigator.onLine) void sync(); }, 15000);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", changeHandler);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, changeHandler);
      window.clearInterval(interval);
    };
  }, [refresh, sync]);

  if (online && pending === 0 && pendingFiles === 0 && !error) return null;
  return (
    <div role="status" aria-live="polite" className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${!online ? "border-orange/40 bg-orange/10 text-orange-ink" : error ? "border-orange/40 bg-orange/10 text-orange-ink" : "border-teal/30 bg-teal/10 text-teal-ink"}`}>
      <span>
        {!online ? "Hors réseau — les actions compatibles sont conservées sur ce téléphone." :
          syncing ? "Synchronisation des actions en attente…" :
          error ? `${pending} action(s) en attente — ${error}` :
          pending > 0 ? `${pending} action(s) en attente de synchronisation.` :
          `${pendingFiles} document(s) conservé(s) sur le téléphone, en attente de validation du formulaire.`}
      </span>
      {online && pending > 0 && <button type="button" onClick={() => void sync()} className="font-semibold underline underline-offset-2">Réessayer</button>}
    </div>
  );
}
