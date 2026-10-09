"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

export function ClockButton({ clockedIn }: { clockedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/time-clock", { method: "POST" });
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
