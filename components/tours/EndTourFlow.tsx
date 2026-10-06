"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { QrScanner } from "@/components/fuel/QrScanner";
import { CounterPhotoCapture } from "@/components/shared/CounterPhotoCapture";
import { TourReportPhotoCapture } from "@/components/shared/TourReportPhotoCapture";
import { Card, EmptyState } from "@/components/ui";
import type { TourReportFields } from "@/lib/ocr/tour-report";

interface OpenTour {
  id: string;
  tour_number: string;
  start_at: string;
  vehicles: { id: string; registration: string } | null;
}

/**
 * Retour de tournée: scan véhicule → vérifie que ça correspond à la
 * tournée ouverte du chauffeur → kilométrage retour (obligatoire) +
 * état du véhicule (obligatoire, jamais précoché) → validation
 * explicite. La photo du rapport et celle du compteur (sauf réglage
 * d'organisation contraire) restent facultatives et ne bloquent
 * jamais l'envoi. end_at est pris automatiquement à l'envoi.
 */
export function EndTourFlow({
  initialVehicleId,
  requireOdometerPhoto = false,
}: {
  initialVehicleId?: string;
  requireOdometerPhoto?: boolean;
} = {}) {
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
  const [returnType, setReturnType] = useState<"depot" | "domicile">("depot");
  const [sheetPhotoPath, setSheetPhotoPath] = useState("");
  const [reportFields, setReportFields] = useState<TourReportFields | null>(null);
  const [vehicleOk, setVehicleOk] = useState<boolean | null>(null);
  const [problemDescription, setProblemDescription] = useState("");
  const [problemPhotoFile, setProblemPhotoFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Same shortcut as StartTourFlow: a vehicle already identified by
  // /v/[id] doesn't need a second scan to run the same open-tour check.
  useEffect(() => {
    if (initialVehicleId) handleScan(initialVehicleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVehicleId]);

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

  const canSubmit =
    Boolean(vehicleId) &&
    Boolean(openTour) &&
    Boolean(endKm) &&
    (!requireOdometerPhoto || Boolean(endKmPhotoPath)) &&
    vehicleOk !== null &&
    (vehicleOk || problemDescription.trim().length > 0) &&
    confirmed;

  async function submit() {
    if (!vehicleId || !openTour || vehicleOk === null) return;
    setBusy(true);
    setError(null);
    try {
      const patchRes = await fetch(`/api/tours/${openTour.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          end_km: Number(endKm),
          end_km_photo_path: endKmPhotoPath || undefined,
          sheet_photo_path: sheetPhotoPath || undefined,
          report_fields: reportFields ?? undefined,
          notes: notes || undefined,
          return_type: returnType,
          vehicle_ok: vehicleOk,
          problem_description: vehicleOk ? undefined : problemDescription,
        }),
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) throw new Error(typeof patchJson.error === "string" ? patchJson.error : "Erreur");

      const { problemPhotoStoragePath } = patchJson as { problemPhotoStoragePath: string | null };
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
        <label className="label">Kilométrage au retour *</label>
        <input className="input" type="number" value={endKm} onChange={(e) => setEndKm(e.target.value)} />
        <div className="mt-1.5">
          <CounterPhotoCapture
            label={`Photo compteur kilométrique${requireOdometerPhoto ? " (obligatoire)" : " (optionnel)"}`}
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
        <label className="label">État du véhicule *</label>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/5 p-3 text-sm">
            <input type="radio" name="vehicle-ok" checked={vehicleOk === true} onChange={() => setVehicleOk(true)} />
            Aucun problème nouveau
          </label>
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/5 p-3 text-sm">
            <input type="radio" name="vehicle-ok" checked={vehicleOk === false} onChange={() => setVehicleOk(false)} />
            Problème apparu pendant la tournée
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

      <div>
        <label className="label">Retour</label>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/5 p-3 text-sm">
            <input type="radio" name="return-type" checked={returnType === "depot"} onChange={() => setReturnType("depot")} />
            Retour au dépôt
          </label>
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/5 p-3 text-sm">
            <input
              type="radio"
              name="return-type"
              checked={returnType === "domicile"}
              onChange={() => setReturnType("domicile")}
            />
            Retour direct à domicile
          </label>
        </div>
      </div>

      <div>
        <label className="label">Remarques (optionnel)</label>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <TourReportPhotoCapture
        label="Photo du compte-rendu de tournée (optionnel — lecture auto)"
        onCaptured={({ photoPath, fields }) => {
          setSheetPhotoPath(photoPath);
          setReportFields(fields);
        }}
      />
      {reportFields && (
        <p className="text-xs text-teal-ink">
          Lu automatiquement :{" "}
          {[
            reportFields.return_time && `retour ${reportFields.return_time}`,
            reportFields.stops_delivered !== null && `${reportFields.stops_delivered} arrêts livrés`,
            reportFields.packages_missing !== null && `${reportFields.packages_missing} colis manquants`,
            reportFields.pickups !== null && `${reportFields.pickups} stops de ramasse`,
            reportFields.packages_picked_up !== null && `${reportFields.packages_picked_up} colis ramassés`,
            reportFields.packages_returned !== null && `${reportFields.packages_returned} colis ramenés au dépôt`,
            reportFields.packages_relay !== null && `${reportFields.packages_relay} colis en relais`,
          ]
            .filter(Boolean)
            .join(" · ") || "aucune donnée exploitable sur cette photo"}
        </p>
      )}

      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        Je confirme terminer la tournée avec le véhicule{openTour?.vehicles ? ` ${openTour.vehicles.registration}` : ""}.
      </label>

      <button className="btn-primary w-full justify-center text-base" disabled={!canSubmit || busy} onClick={submit}>
        {busy ? "Envoi…" : "Valider mon retour"}
      </button>
    </Card>
  );
}
