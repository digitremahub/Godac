"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

interface PlannedToday {
  id: string;
  tour_number: string;
  start_at: string;
  vehicles: { id: string; registration: string } | null;
}

interface ServiceOption {
  id: string;
  name: string;
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
  const [plannedToday, setPlannedToday] = useState<PlannedToday | null>(null);
  const [polyvalentServices, setPolyvalentServices] = useState<ServiceOption[] | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [tourNumber, setTourNumber] = useState("");
  const [startKm, setStartKm] = useState("");
  const [startKmPhotoPath, setStartKmPhotoPath] = useState("");
  const [sheetPhotoPath, setSheetPhotoPath] = useState("");
  const [reportFields, setReportFields] = useState<TourReportFields | null>(null);
  const [vehicleOk, setVehicleOk] = useState<boolean | null>(null);
  const [problemDescription, setProblemDescription] = useState("");
  const [problemPhotoFile, setProblemPhotoFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [vehicleChanged, setVehicleChanged] = useState(false);
  const [changeReason, setChangeReason] = useState("");
  const [showScanner, setShowScanner] = useState(false);

  // Loaded up front, before any scan, so a driver whose tour was
  // already planned with a vehicle can confirm it in one tap — the QR
  // scanner is only shown for the no-plan case or an explicit "ce
  // n'est pas le bon véhicule" swap (handleScan below, re-run against
  // whatever was actually scanned).
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
        setOpenTour(json.tour);
        setPlannedToday(json.plannedToday ?? null);
        setPolyvalentServices(json.polyvalentServices ?? null);
        if (json.plannedToday && !tourNumber) setTourNumber(json.plannedToday.tour_number);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur inattendue");
      } finally {
        setLoadingPlan(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVehicleId]);

  function confirmPlannedVehicle() {
    if (!plannedToday?.vehicles) return;
    setVehicleId(plannedToday.vehicles.id);
    setRegistration(plannedToday.vehicles.registration);
    setVehicleChanged(false);
  }

  async function handleScan(id: string) {
    setVehicleId(id);
    setShowScanner(false);
    setChecking(true);
    setError(null);
    try {
      const [openRes, vehicleRes] = await Promise.all([fetch("/api/tours/open"), fetch(`/api/vehicles/${id}`)]);
      const openJson = await openRes.json();
      if (!openRes.ok) throw new Error(typeof openJson.error === "string" ? openJson.error : "Erreur");
      setOpenTour(openJson.tour);
      setPlannedToday(openJson.plannedToday ?? null);
      setPolyvalentServices(openJson.polyvalentServices ?? null);
      if (openJson.plannedToday && !tourNumber) setTourNumber(openJson.plannedToday.tour_number);
      setVehicleChanged(Boolean(openJson.plannedToday?.vehicles && openJson.plannedToday.vehicles.id !== id));
      const vehicleJson = await vehicleRes.json();
      if (vehicleRes.ok) setRegistration(vehicleJson.vehicle?.registration ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setChecking(false);
      setLoadingPlan(false);
    }
  }

  const canSubmit =
    Boolean(vehicleId) &&
    Boolean(startKm) &&
    (!requireOdometerPhoto || Boolean(startKmPhotoPath)) &&
    vehicleOk !== null &&
    (vehicleOk || problemDescription.trim().length > 0) &&
    (!vehicleChanged || changeReason.trim().length > 0) &&
    (!polyvalentServices || Boolean(serviceId)) &&
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
          service_id: polyvalentServices ? serviceId : undefined,
          tour_number: tourNumber || undefined,
          planned_entry_id: plannedToday?.id,
          start_km: Number(startKm),
          start_km_photo_path: startKmPhotoPath || undefined,
          sheet_photo_path: sheetPhotoPath || undefined,
          report_fields: reportFields ?? undefined,
          vehicle_ok: vehicleOk,
          problem_description: vehicleOk ? undefined : problemDescription,
          change_reason: vehicleChanged ? changeReason : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");

      const { problemPhotoStoragePath } = json as { problemPhotoStoragePath: string | null };
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

  if (loadingPlan) {
    return <p className="text-sm text-navy/70">Chargement…</p>;
  }

  if (!vehicleId) {
    // A planned vehicle is confirmed in one tap, no scan needed — the
    // scanner only appears for the no-plan case, or explicitly via
    // "Changement de véhicule" below (showScanner).
    if (plannedToday?.vehicles && !showScanner) {
      return (
        <Card className="flex flex-col gap-3">
          <p className="text-sm">
            Tournée n°{plannedToday.tour_number} prévue aujourd&apos;hui — véhicule{" "}
            <span className="font-medium">{plannedToday.vehicles.registration}</span>.
          </p>
          <button className="btn-primary w-full justify-center" onClick={confirmPlannedVehicle}>
            <IconCheck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Commencer avec {plannedToday.vehicles.registration}
          </button>
          <button className="btn-secondary w-full justify-center text-sm" onClick={() => setShowScanner(true)}>
            <IconRefresh className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Changement de véhicule — scanner le véhicule remplaçant
          </button>
        </Card>
      );
    }
    return <QrScanner expected="vehicle" label="Scannez le QR du véhicule" onScan={(p) => handleScan(p.id)} />;
  }

  if (checking) {
    return <p className="text-sm text-navy/70">Vérification…</p>;
  }

  if (openTour) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-orange-ink">
          Vous avez déjà une tournée en cours (n°{openTour.tour_number}
          {openTour.vehicles ? ` — ${openTour.vehicles.registration}` : ""}, depuis{" "}
          {new Date(openTour.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris" })}).
        </p>
        <Link href="/tours/end" className="btn-primary text-center">
          Terminer cette tournée
        </Link>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      {plannedToday && (
        <p className="rounded-lg bg-teal/10 px-3 py-2 text-xs text-teal-ink">
          Tournée n°{plannedToday.tour_number} prévue aujourd&apos;hui
          {plannedToday.vehicles ? ` — véhicule ${plannedToday.vehicles.registration}` : ""}. Le planning sera mis à jour automatiquement.
        </p>
      )}

      {vehicleChanged && (
        <div className="flex flex-col gap-2 rounded-lg border border-gold-ink/20 bg-gold-ink/5 p-3">
          <p className="text-xs text-gold-ink">
            Ce véhicule ({registration ?? "?"}) n&apos;est pas celui prévu au planning
            {plannedToday?.vehicles ? ` (${plannedToday.vehicles.registration})` : ""} — un responsable sera prévenu.
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

      {polyvalentServices && (
        <div>
          <label className="block"><span className="label">Service sur lequel vous travaillez aujourd&apos;hui *</span>
          <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Choisissez un service…</option>
            {polyvalentServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select></label>
        </div>
      )}

      <div>
        <label className="block"><span className="label">Numéro de tournée (optionnel)</span>
        <input
          className="input"
          value={tourNumber}
          onChange={(e) => setTourNumber(e.target.value)}
          placeholder="Laissez vide pour un numéro automatique"
        /></label>
      </div>

      <div>
        <label className="block"><span className="label">Kilométrage au départ *</span>
        <input className="input" type="number" value={startKm} onChange={(e) => setStartKm(e.target.value)} /></label>
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

      <fieldset>
        <legend className="label">État du véhicule *</legend>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/[0.04] p-3 text-sm">
            <input type="radio" name="vehicle-ok" checked={vehicleOk === true} onChange={() => setVehicleOk(true)} />
            Contrôle visuel effectué, véhicule conforme
          </label>
          <label className="flex min-h-[44px] items-center gap-2 rounded-lg bg-navy/[0.04] p-3 text-sm">
            <input type="radio" name="vehicle-ok" checked={vehicleOk === false} onChange={() => setVehicleOk(false)} />
            Problème constaté
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

      <TourReportPhotoCapture
        label="Photo du rapport de tournée (optionnel — lecture auto)"
        onCaptured={({ photoPath, fields }) => {
          setSheetPhotoPath(photoPath);
          setReportFields(fields);
          if (fields?.tour_number && !tourNumber) setTourNumber(fields.tour_number);
        }}
      />
      {reportFields && (
        <p className="text-xs text-teal-ink">
          Lu automatiquement :{" "}
          {[
            reportFields.tour_number && `tournée n°${reportFields.tour_number}`,
            reportFields.bl_number && `BL ${reportFields.bl_number}`,
            reportFields.departure_time && `départ ${reportFields.departure_time}`,
            reportFields.stops_total !== null && `${reportFields.stops_total} arrêts`,
            reportFields.packages_count !== null && `${reportFields.packages_count} colis`,
          ]
            .filter(Boolean)
            .join(" · ") || "aucune donnée exploitable sur cette photo"}
        </p>
      )}

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
