"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

type GeoResult = { position: { latitude: number; longitude: number } | null; denied: boolean };

/**
 * Best-effort — resolves `position: null` on denial/timeout/unsupported
 * rather than ever blocking the badge action itself, but still reports
 * *why* (permission denied vs. no fix in time vs. unsupported) so the
 * UI can tell the driver their badge was saved without a position,
 * instead of leaving "position inconnue" a silent mystery later.
 * enableHighAccuracy + an 8s timeout (up from a plain 5s default):
 * a cold GPS fix genuinely can take a few seconds, and this is the one
 * moment that's worth waiting slightly longer for.
 */
function getCurrentPosition(): Promise<GeoResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ position: null, denied: false });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ position: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, denied: false }),
      (err) => resolve({ position: null, denied: err.code === err.PERMISSION_DENIED }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

export function ClockButton({ clockedIn }: { clockedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geoWarning, setGeoWarning] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    setGeoWarning(null);
    try {
      const { position, denied } = await getCurrentPosition();
      const res = await fetch("/api/time-clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(position ?? {}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      if (!position) {
        setGeoWarning(
          denied
            ? "Badgeage enregistré sans position — localisation refusée. Autorisez-la dans les réglages du navigateur pour la prochaine fois."
            : "Badgeage enregistré sans position — signal GPS non capté à temps.",
        );
      }
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
        {busy ? "…" : (
        <>
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${clockedIn ? "bg-orange" : "bg-teal"}`} />
          {clockedIn ? "Badger la sortie" : "Badger l'entrée"}
        </>
      )}
      </button>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {geoWarning && <p className="text-xs text-gold-ink">{geoWarning}</p>}
    </Card>
  );
}
