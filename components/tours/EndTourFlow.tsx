"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { QrScanner } from "@/components/fuel/QrScanner";
import { CounterPhotoCapture } from "@/components/shared/CounterPhotoCapture";
import { Card, EmptyState } from "@/components/ui";

interface OpenTour {
  id: string;
  tour_number: string;
  start_at: string;
  vehicles: { id: string; registration: string } | null;
}

/**
 * Retour de tournée: scan véhicule → vérifie que ça correspond à la
 * tournée ouverte du chauffeur → kilométrage retour + anomalies →
 * photo du rapport. end_at est pris automatiquement à l'envoi.
 */
export function EndTourFlow() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [openTour, setOpenTour] = useState<OpenTour | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [none, setNone] = useState(false);
  const [endKm, setEndKm] = useState("");
  const [endKmPhotoPath, setEndKmPhotoPath] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleScan(id: string) {
    setVehicleId(id);
    setChecking(true);
    setError(null);
    setMismatch(false);
    setNone(false);
    try {
      const res = await fetch("/api/tours/open");
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      const tour = json.tour as OpenTour | null;
      if (!tour) {
        setNone(true);
      } else if (tour.vehicles?.id !== id) {
        setOpenTour(tour);
        setMismatch(true);
      } else {
        setOpenTour(tour);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setChecking(false);
    }
  }

  async function handlePhoto(file: File) {
    if (!vehicleId || !openTour) return;
    setBusy(true);
    setError(null);
    try {
      const patchRes = await fetch(`/api/tours/${openTour.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          end_km: endKm ? Number(endKm) : undefined,
          end_km_photo_path: endKmPhotoPath || undefined,
          notes: notes || undefined,
        }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) throw new Error(typeof patchJson.error === "string" ? patchJson.error : "Erreur");

      const { storagePath } = patchJson as { storagePath: string };
      const { error: uploadError } = await supabase.storage
        .from("tour-photos")
        .upload(storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué: ${uploadError.message}`);

      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <EmptyState title="Tournée terminée" description="Le retour a été enregistré. À demain !" />;
  }

  if (!vehicleId) {
    return <QrScanner expected="vehicle" label="Scannez le QR du véhicule au retour" onScan={(p) => handleScan(p.id)} />;
  }

  if (checking) {
    return <p className="text-sm text-navy/60">Vérification…</p>;
  }

  if (none) {
    return (
      <EmptyState
        title="Aucune tournée en cours"
        description="Scannez le véhicule au départ pour démarrer une tournée avant de pouvoir la clôturer."
      />
    );
  }

  if (mismatch && openTour) {
    return (
      <Card>
        <p className="text-sm text-orange-ink">
          Votre tournée en cours concerne un autre véhicule ({openTour.vehicles?.registration ?? "inconnu"}).
          Scannez ce véhicule pour la terminer.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      <p className="text-sm text-navy/60">
        Tournée n°{openTour?.tour_number} — {openTour?.vehicles?.registration}
      </p>
      <div>
        <label className="label">Kilométrage au retour</label>
        <input className="input" type="number" value={endKm} onChange={(e) => setEndKm(e.target.value)} />
        <div className="mt-1.5">
          <CounterPhotoCapture
            label="Photo compteur kilométrique"
            initUrl="/api/ocr/odometer/init"
            processUrl="/api/ocr/odometer/process"
            bucket="tour-photos"
            onCaptured={({ photoPath, reading }) => {
              setEndKmPhotoPath(photoPath);
              if (reading !== null) setEndKm(String(reading));
            }}
          />
        </div>
      </div>
      <div>
        <label className="label">Anomalies / incidents (optionnel)</label>
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <label
        className={`btn-primary w-full cursor-pointer justify-center text-center ${
          busy ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {busy ? "Envoi…" : "📷 Photo du rapport de retour"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0])}
        />
      </label>
    </Card>
  );
}
