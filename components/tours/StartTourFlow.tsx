"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
 * Départ de tournée: scan véhicule → numéro de tournée (facultatif) +
 * kilométrage (obligatoire) + état du véhicule (obligatoire, jamais
 * précoché) → validation explicite. La photo de la feuille papier et
 * celle du compteur (sauf réglage d'organisation contraire) restent
 * facultatives et ne bloquent jamais l'envoi. Départ/heure sont pris
 * automatiquement au moment de l'envoi (start_at).
 */
export function StartTourFlow({
  initialVehicleId,
  requireOdometerPhoto = false,
}: {
  initialVehicleId?: string;
  requireOdometerPhoto?: boolean;
} = {}) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [registration, setRegistration] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [openTour, setOpenTour] = useState<OpenTour | null>(null);
  const [tourNumber, setTourNumber] = useState("");
  const [startKm, setStartKm] = useState("");
  const [startKmPhotoPath, setStartKmPhotoPath] = useState("");
  const [sheetPhotoFile, setSheetPhotoFile] = useState<File | null>(null);
  const [vehicleOk, setVehicleOk] = useState<boolean | null>(null);
  const [problemDescription, setProblemDescription] = useState("");
  const [problemPhotoFile, setProblemPhotoFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Arriving from the vehicle's own QR landing page (/v/[id]) already
  // identifies the vehicle — skip straight to the same check the
  // scanner would have triggered instead of asking for a second scan.
  useEffect(() => {
    if (initialVehicleId) handleScan(initialVehicleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVehicleId]);

  async function handleScan(id: string) {
    setVehicleId(id);
    setChecking(true);
    setError(null);
    try {
      const [openRes, vehicleRes] = await Promise.all([fetch("/api/tours/open"), fetch(`/api/vehicles/${id}`)]);
      const openJson = await openRes.json();
      if (!openRes.ok) throw new Error(typeof openJson.error === "string" ? openJson.error : "Erreur");
      setOpenTour(openJson.tour);
      const vehicleJson = await vehicleRes.json();
      if (vehicleRes.ok) setRegistration(vehicleJson.vehicle?.registration ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setChecking(false);
    }
  }

  const canSubmit =
    Boolean(vehicleId) &&
    Boolean(startKm) &&
    (!requireOdometerPhoto || Boolean(startKmPhotoPath)) &&
    vehicleOk !== null &&
    (vehicleOk || problemDescription.trim().length > 0) &&
    confirmed;

  async function submit() {
    if (!vehicleId || vehicleOk === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          tour_number: tourNumber || undefined,
          start_km: Number(startKm),
          start_km_photo_path: startKmPhotoPath || undefined,
          has_sheet_photo: Boolean(sheetPhotoFile),
          vehicle_ok: vehicleOk,
          problem_description: vehicleOk ? undefined : problemDescription,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");

      const { storagePath, problemPhotoStoragePath } = json as {
        storagePath: string;
        problemPhotoStoragePath: string | null;
      };
      if (sheetPhotoFile) {
        const { error: uploadError } = await supabase.storage
          .from("tour-photos")
          .upload(storagePath, sheetPhotoFile, { contentType: sheetPhotoFile.type });
        if (uploadError) throw new Error(`Envoi de la photo de feuille échoué: ${uploadError.message}`);
      }
      if (problemPhotoFile && problemPhotoStoragePath) {
        const { error: uploadError } = await supabase.storage
          .from("tour-photos")
          .upload(problemPhotoStoragePath, problemPhotoFile, { contentType: problemPhotoFile.type });
        if (uploadError) throw new Error(`Envoi de la photo du problème échoué: ${uploadError.message}`);
      }

      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <EmptyState title="Tournée démarrée" description="Le départ a été enregistré. Bonne route !" />;
  }

  if (!vehicleId) {
    return <QrScanner expected="vehicle" label="Scannez le QR du véhicule" onScan={(p) => handleScan(p.id)} />;
  }

  if (checking) {
    return <p className="text-sm text-navy/60">Vérification…</p>;
  }

  if (openTour) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-orange-ink">
          Vous avez déjà une tournée en cours (n°{openTour.tour_number}
          {openTour.vehicles ? ` — ${openTour.vehicles.registration}` : ""}, depuis{" "}
          {new Date(openTour.start_at).toLocaleTimeString("fr-FR")}).
        </p>
        <Link href="/tours/end" className="btn-primary text-center">
          Terminer cette tournée
        </Link>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      {error && <p className="text-sm text-orange-ink">{error}</p>}

      <div>
        <label className="label">Numéro de tournée (optionnel)</label>
        <input
          className="input"
          value={tourNumber}
          onChange={(e) => setTourNumber(e.target.value)}
          placeholder="Laissez vide pour un numéro automatique"
        />
      </div>

      <div>
        <label className="label">Kilométrage au départ *</label>
        <input className="input" type="number" value={startKm} onChange={(e) => setStartKm(e.target.value)} />
        <div className="mt-1.5">
          <CounterPhotoCapture
            label={`Photo compteur kilométrique${requireOdometerPhoto ? " (obligatoire)" : " (optionnel)"}`}
            initUrl="/api/ocr/odometer/init"
            processUrl="/api/ocr/odometer/process"
            bucket="tour-photos"
            onCaptured={({ photoPath, reading }) => {
              setStartKmPhotoPath(photoPath);
              if (reading !== null) setStartKm(String(reading));
            }}
          />
        </div>
      </div>

      <div>
        <label className="label">État du véhicule *</label>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/5 p-3 text-sm">
            <input type="radio" name="vehicle-ok" checked={vehicleOk === true} onChange={() => setVehicleOk(true)} />
            Contrôle visuel effectué, véhicule conforme
          </label>
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/5 p-3 text-sm">
            <input type="radio" name="vehicle-ok" checked={vehicleOk === false} onChange={() => setVehicleOk(false)} />
            Problème constaté
          </label>
        </div>
      </div>

      {vehicleOk === false && (
        <div className="flex flex-col gap-2 rounded-lg border border-orange-ink/20 bg-orange-ink/5 p-3">
          <div>
            <label className="label">Description du problème *</label>
            <textarea
              className="input"
              rows={3}
              value={problemDescription}
              onChange={(e) => setProblemDescription(e.target.value)}
            />
          </div>
          <label className="btn-secondary w-full cursor-pointer justify-center text-center text-xs">
            {problemPhotoFile ? "Photo sélectionnée ✓" : "📷 Photo du problème (optionnel)"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setProblemPhotoFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-xs text-orange-ink">Un signalement sera créé automatiquement pour les gestionnaires.</p>
        </div>
      )}

      <label className="btn-secondary w-full cursor-pointer justify-center text-center">
        {sheetPhotoFile ? "Photo de la feuille sélectionnée ✓" : "📷 Photo de la feuille de départ (optionnel)"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => setSheetPhotoFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Je confirme démarrer la tournée avec le véhicule{registration ? ` ${registration}` : ""}.
      </label>

      <button className="btn-primary w-full justify-center text-base" disabled={!canSubmit || busy} onClick={submit}>
        {busy ? "Envoi…" : "Valider mon départ"}
      </button>
    </Card>
  );
}
