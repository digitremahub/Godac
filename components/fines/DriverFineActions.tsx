"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DriverFineActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function contest() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/fines/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "contested" }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Impossible de signaler la contestation.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur réseau."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col items-start gap-2">
    <button type="button" className="btn-secondary" disabled={busy} onClick={contest}>{busy ? "Envoi…" : "Signaler une contestation"}</button>
    {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
  </div>;
}
