"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function VehicleAssignmentActions({
  vehicleId,
  claim,
  label,
}: {
  vehicleId: string;
  claim: boolean;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/assignment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button className={claim ? "btn-primary" : "btn-secondary"} disabled={busy} onClick={run}>
        {busy ? "…" : label}
      </button>
      {error && <p className="text-xs text-orange-ink">{error}</p>}
    </div>
  );
}
