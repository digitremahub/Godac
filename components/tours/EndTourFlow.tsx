"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { QrScanner } from "@/components/fuel/QrScanner";
import { CounterPhotoCapture } from "@/components/shared/CounterPhotoCapture";
import { TourReportPhotoCapture } from "@/components/shared/TourReportPhotoCapture";
import { Card, EmptyState } from "@/components/ui";
import type { TourReportFields } from "@/lib/ocr/tour-report";
import { IconCamera, IconCheck, IconRefresh } from "@/components/layout/icons";

interface OpenTour {
  id: string;
  tour_number: string;
  start_at: string;
  vehicles: { id: string; registration: string } | null;
}

/**
 * Retour de tournée: le véhicule est auto-sélectionné depuis la
 * tournée déjà ouverte du chauffeur (pas de re-scan par défaut) —
 * seul un "changement de véhicule" explicite (panne, échange en
 * cours de tournée) demande de scanner le remplaçant et d'indiquer un
 * motif, un responsable étant alors prévenu. Kilométrage retour
 * (obligatoire) + état du véhicule (obligatoire, jamais précoché) →
 * validation explicite. La photo du rapport et celle du compteur
 * (sauf réglage d'organisation contraire) restent facultatives et ne
 * bloquent jamais l'envoi. end_at est pris automatiquement à l'envoi.
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
  const [registration, setRegistration] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadingTour, setLoadingTour] = useState(true);
  const [openTour, setOpenTour] = useState<OpenTour | null>(null);
  const [none, setNone] = useState(false);
  const [vehicleChanged, setVehicleChanged] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [showScanner, setShowScanner] = useState(false);
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

  // Loaded up front, before any scan, so the vehicle used at
  // departure is confirmed in one tap — the QR scanner is only shown
  // for an explicit "changement de véhicule" (handleScan below,
  // re-run against whatever was actually scanned) or when a vehicle
  // was already identified by /v/[id] (initialVehicleId).
  useEffect(() => {
    if (initialVehicleId) {
      handleScan(initialVehicleId);
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/tours/open");
        const json = await res.json();
        if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
        const tour = json.tour as OpenTour | null;
        setOpenTour(tour);
        if (!tour) setNone(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur inattendue");
      } finally {
        setLoadingTour(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVehicleId]);

  function confirmOpenVehicle() {
    if (!openTour?.vehicles) return;
    setVehicleId(openTour.vehicles.id);
    setRegistration(openTour.vehicles.registration);
    setVehicleChanged(false);
  }

  async function handleScan(id: string) {
    setVehicleId(id);
    setShowScanner(false);
    setChecking(true);
    setError(null);
    setNone(false);
    try {
      const [openRes, vehicleRes] = await Promise.all([fetch("/api/tours/open"), fetch(`/api/vehicles/${id}`)]);
      const openJson = await openRes.json();
      if (!openRes.ok) throw new Error(typeof openJson.error === "string" ? openJson.error : "Erreur");
      const tour = openJson.tour as OpenTour | null;
      setOpenTour(tour);
      if (!tour) {
        setNone(true);
        return;
      }
      setVehicleChanged(Boolean(tour.vehicles && tour.vehicles.id !== id));
      const vehicleJson = await vehicleRes.json();
      if (vehicleRes.ok) setRegistration(vehicleJson.vehicle?.registration ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setChecking(false);
      setLoadingTour(false);
    }
  }

  const canSubmit =
    Boolean(vehicleId) &&
    Boolean(openTour) &&
    Boolean(endKm) &&
    (!requireOdometerPhoto || Boolean(endKmPhotoPath)) &&
    vehicleOk !== null &&
    (vehicleOk || problemDescription.trim().length > 0) &&
    (!vehicleChanged || changeReason.trim().length > 0) &&
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
          change_reason: vehicleChanged ? changeReason : undefined,
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

  if (loadingTour) {
    return <p className="text-sm text-navy/70">Chargement…</p>;
  }

  if (none) {
    return (
      <EmptyState
        title="Aucune tournée en cours"
        description="Démarrez une tournée avant de pouvoir la clôturer."
      />
    );
  }

  if (!vehicleId) {
    // The vehicle used at departure is confirmed in one tap, no scan
    // needed — the scanner only appears via "Changement de véhicule"
    // below (showScanner).
    if (openTour?.vehicles && !showScanner) {
      return (
        <Card className="flex flex-col gap-3">
          <p className="text-sm">
            Tournée n°{openTour.tour_number} en cours — véhicule <span className="font-medium">{openTour.vehicles.registration}</span>.
          </p>
          <button className="btn-primary w-full justify-center" onClick={confirmOpenVehicle}>
            <IconCheck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Terminer avec {openTour.vehicles.registration}
          </button>
          <button className="btn-secondary w-full justify-center text-sm" onClick={() => setShowScanner(true)}>
            <IconRefresh className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Changement de véhicule — scanner le véhicule remplaçant
          </button>
        </Card>
      );
    }
    return <QrScanner expected="vehicle" label="Scannez le QR du véhicule au retour" onScan={(p) => handleScan(p.id)} />;
  }

  if (checking) {
    return <p className="text-sm text-navy/70">Vérification…</p>;
  }

  return (
    <Card className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      <p className="text-sm text-navy/70">
        Tournée n°{openTour?.tour_number} — {registration ?? openTour?.vehicles?.registration}
      </p>

      {vehicleChanged && (
        <div className="flex flex-col gap-2 rounded-lg border border-gold-ink/20 bg-gold-ink/5 p-3">
          <p className="text-xs text-gold-ink">
            Ce véhicule ({registration ?? "?"}) n&apos;est pas celui utilisé au départ
            {openTour?.vehicles ? ` (${openTour.vehicles.registration})` : ""} — un responsable sera prévenu.
          </p>
          <div>
            <label className="block"><span className="label">Motif du changement *</span>
            <textarea
              className="input"
              rows={2}
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="ex: panne, maintenance, véhicule indisponible…"
            /></label>
          </div>
        </div>
      )}

      <div>
        <label className="block"><span className="label">Kilométrage au retour *</span>
        <input className="input" type="number" value={endKm} onChange={(e) => setEndKm(e.target.value)} /></label>
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

      <fieldset>
        <legend className="label">État du véhicule *</legend>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/[0.04] p-3 text-sm">
            <input type="radio" name="vehicle-ok" checked={vehicleOk === true} onChange={() => setVehicleOk(true)} />
            Aucun problème nouveau
          </label>
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/[0.04] p-3 text-sm">
            <input type="radio" name="vehicle-ok" checked={vehicleOk === false} onChange={() => setVehicleOk(false)} />
            Problème apparu pendant la tournée
          </label>
        </div>
      </fieldset>

      {vehicleOk === false && (
        <div className="flex flex-col gap-2 rounded-lg border border-orange-ink/20 bg-orange-ink/5 p-3">
          <div>
            <label className="block"><span className="label">Description du problème *</span>
            <textarea
              className="input"
              rows={3}
              value={problemDescription}
              onChange={(e) => setProblemDescription(e.target.value)}
            /></label>
          </div>
          <label className="btn-secondary w-full cursor-pointer justify-center text-center text-xs">
            {problemPhotoFile ? <>Photo sélectionnée <IconCheck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /></> : <><IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Photo du problème (optionnel)</>}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => setProblemPhotoFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-xs text-orange-ink">Un signalement sera créé automatiquement pour les gestionnaires.</p>
        </div>
      )}

      <fieldset>
        <legend className="label">Retour</legend>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/[0.04] p-3 text-sm">
            <input type="radio" name="return-type" checked={returnType === "depot"} onChange={() => setReturnType("depot")} />
            Retour au dépôt
          </label>
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/[0.04] p-3 text-sm">
            <input
              type="radio"
              name="return-type"
              checked={returnType === "domicile"}
              onChange={() => setReturnType("domicile")}
            />
            Retour direct à domicile
          </label>
        </div>
      </fieldset>

      <div>
        <label className="block"><span className="label">Remarques (optionnel)</span>
        <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
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
        Je confirme terminer la tournée avec le véhicule{(registration ?? openTour?.vehicles?.registration) ? ` ${registration ?? openTour?.vehicles?.registration}` : ""}.
      </label>

      <button className="btn-primary w-full justify-center text-base" disabled={!canSubmit || busy} onClick={submit}>
        {busy ? "Envoi…" : "Valider mon retour"}
      </button>
    </Card>
  );
}
