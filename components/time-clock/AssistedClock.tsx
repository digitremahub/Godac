"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconCheck, IconMapPin } from "@/components/layout/icons";

type Banner =
  | { kind: "auto_in"; entryId: string; time: string }
  | { kind: "offer_out" }
  | { kind: "done"; message: string }
  | null;

const OFFER_OUT_AFTER_MS = 3 * 60 * 60 * 1000;

function readPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    });
  });
}

/**
 * Pointage assisté — reads the position once, when the dashboard
 * opens (never in the background), and asks the server whether the
 * user is at one of their depots (app/api/time-clock/assisted):
 * clocks in automatically with an « Annuler » escape hatch, or — once
 * the tour is closed and they've been in for a while — offers the
 * clock-out as a single tap. Rendered only when the organization
 * enabled it.
 */
export function AssistedClock({ hasOpenTour }: { hasOpenTour: boolean }) {
  const router = useRouter();
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const pos = await readPosition();
      if (!pos) return;
      const res = await fetch("/api/time-clock/assisted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      }).catch(() => null);
      if (!res?.ok) return;
      const json = await res.json();
      if (json.status === "auto_clocked_in") {
        const time = new Date(json.clockedInAt).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
        setBanner({ kind: "auto_in", entryId: json.entryId, time });
        router.refresh();
      } else if (
        json.status === "clocked_in" &&
        json.atDepot &&
        !hasOpenTour &&
        Date.now() - new Date(json.clockedInAt).getTime() > OFFER_OUT_AFTER_MS
      ) {
        setBanner({ kind: "offer_out" });
      }
    })();
  }, [hasOpenTour, router]);

  async function undo(entryId: string) {
    setBusy(true);
    const res = await fetch(`/api/time-clock/assisted?id=${entryId}`, { method: "DELETE" });
    setBusy(false);
    setBanner({ kind: "done", message: res.ok ? "Pointage annulé." : "Ce pointage ne peut plus être annulé — contactez votre responsable." });
    router.refresh();
  }

  async function clockOut() {
    setBusy(true);
    const pos = await readPosition();
    const res = await fetch("/api/time-clock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pos ? { latitude: pos.coords.latitude, longitude: pos.coords.longitude } : {}),
    });
    setBusy(false);
    setBanner({ kind: "done", message: res.ok ? "Sortie pointée. Bonne soirée !" : "Le pointage de sortie a échoué — réessayez depuis la pointeuse." });
    router.refresh();
  }

  if (!banner) return null;

  return (
    <div role="status" className="mb-6 flex flex-col gap-3 rounded-2xl border border-teal/30 bg-teal/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal text-navy">
          {banner.kind === "offer_out" ? <IconMapPin className="h-5 w-5" /> : <IconCheck className="h-5 w-5" />}
        </span>
        <p className="text-sm">
          {banner.kind === "auto_in" && (
            <>
              <strong>Entrée pointée à {banner.time}</strong> — vous êtes au dépôt.
            </>
          )}
          {banner.kind === "offer_out" && (
            <>
              <strong>Vous êtes au dépôt.</strong> Votre tournée est terminée : pointer la sortie ?
            </>
          )}
          {banner.kind === "done" && banner.message}
        </p>
      </div>
      {banner.kind === "auto_in" && (
        <button type="button" className="btn-secondary shrink-0" disabled={busy} onClick={() => undo(banner.entryId)}>
          {busy ? "Annulation…" : "Annuler"}
        </button>
      )}
      {banner.kind === "offer_out" && (
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-ghost" onClick={() => setBanner(null)}>
            Plus tard
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={clockOut}>
            {busy ? "Pointage…" : "Pointer la sortie"}
          </button>
        </div>
      )}
    </div>
  );
}
