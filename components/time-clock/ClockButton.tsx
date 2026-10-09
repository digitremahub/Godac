"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

/** Best-effort — resolves `null` on denial/timeout/unsupported rather than ever blocking the badge action itself. */
function getCurrentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60000 },
    );
  });
}

export function ClockButton({ clockedIn }: { clockedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const position = await getCurrentPosition();
      const res = await fetch("/api/time-clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(position ?? {}),
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
    <Card className="flex flex-col items-center gap-3 py-8 text-center">
      <span className={clockedIn ? "badge-teal" : "badge-neutral"}>{clockedIn ? "En poste" : "Hors poste"}</span>
      <button className={clockedIn ? "btn-secondary" : "btn-primary"} disabled={busy} onClick={toggle}>
        {busy ? "…" : clockedIn ? "🔴 Badger la sortie" : "🟢 Badger l'entrée"}
      </button>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
    </Card>
  );
}
