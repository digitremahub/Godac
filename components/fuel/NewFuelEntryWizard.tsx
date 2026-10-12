"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { QrScanner } from "@/components/fuel/QrScanner";
import { CameraCapture, type OcrCaptureResult } from "@/components/fuel/CameraCapture";
import { CounterPhotoCapture } from "@/components/shared/CounterPhotoCapture";
import { FuelEntryForm, type FuelEntryFormValues } from "@/components/fuel/FuelEntryForm";

interface VehicleOption {
  id: string;
  registration: string;
  type: string;
}
interface TankOption {
  id: string;
  name: string;
  fuel_type: string;
}
interface EmployeeOption {
  id: string;
  full_name: string;
}

/**
 * Follows the physical order of a real fill-up instead of one
 * all-fields-at-once screen: chauffeur, puis véhicule, puis la photo
 * du compteur kilométrique (toujours, qu'il s'agisse d'un ticket
 * station ou d'un plein cuve), puis la branche ticket (OCR) ou cuve
 * (totaliseur avant/après), puis validation.
 */
type Phase = "driver" | "vehicle" | "odometer" | "capture-choice" | "ocr" | "tank-before" | "tank-after" | "validate" | "submitted";

const FUEL_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? "fuel-tickets";

export function NewFuelEntryWizard({
  vehicles,
  tanks,
  employees,
  ocrEnabled,
  initialVehicleId,
  initialTankId,
  initialDriverId,
  initialDriverName,
  assignedVehicleId,
  selfDriverId,
  selfDriverName,
  selfIsDriver,
}: {
  vehicles: VehicleOption[];
  tanks: TankOption[];
  /** Tous les chauffeurs/manager_chauffeur actifs — fourni uniquement aux rôles autorisés à saisir un plein pour quelqu'un d'autre (manager/manager_chauffeur/direction), pour une saisie de secours (téléphone en panne, urgence) sans badge à scanner. */
  employees?: EmployeeOption[];
  ocrEnabled: boolean;
  initialVehicleId?: string;
  initialTankId?: string;
  /** A driver's own badge scanned by someone else (shared terminal at the pump, see app/scan/[type]/[id]) — pre-fills the driver step and skips past it, same as initialVehicleId/initialTankId do for theirs. */
  initialDriverId?: string;
  initialDriverName?: string;
  /** This driver's own assigned vehicle (vehicles.assigned_driver_id) — pre-selected and shown locked, with a "changer de véhicule" escape hatch, instead of yet another dropdown to fill in every time. */
  assignedVehicleId?: string;
  selfDriverId: string;
  selfDriverName: string;
  /** False for manager/direction (never drivers themselves) — forces an explicit choice instead of defaulting to their own account, which would otherwise be submitted as the driver_id. */
  selfIsDriver: boolean;
}) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? assignedVehicleId ?? "");
  const [vehicleLocked, setVehicleLocked] = useState(Boolean(assignedVehicleId) && !initialVehicleId);
  const [tankId, setTankId] = useState(initialTankId ?? "");
  const [driverId, setDriverId] = useState(initialDriverId ?? (selfIsDriver ? selfDriverId : ""));
  const [driverLabel, setDriverLabel] = useState(initialDriverName ?? (selfIsDriver ? selfDriverName : ""));
  const [scanTarget, setScanTarget] = useState<"vehicle" | "tank" | "driver" | null>(null);
  // A vehicle+tank passed in already (e.g. from a vehicle/tank QR scan
  // elsewhere) skips straight past driver/vehicle choice — but the
  // odometer photo is never skipped, ticket or cuve alike. A known
  // driver alone (badge scanned, no vehicle/tank yet) only skips the
  // driver step.
  const [phase, setPhase] = useState<Phase>(vehicleId && tankId ? "odometer" : initialDriverId ? "vehicle" : "driver");
  const [ocrResult, setOcrResult] = useState<OcrCaptureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
  const [vehicleKm, setVehicleKm] = useState("");
  const [vehicleKmPhotoPath, setVehicleKmPhotoPath] = useState("");
  const [totalizerBefore, setTotalizerBefore] = useState("");
  const [totalizerBeforePhotoPath, setTotalizerBeforePhotoPath] = useState("");
  const [totalizerAfter, setTotalizerAfter] = useState("");
  const [totalizerAfterPhotoPath, setTotalizerAfterPhotoPath] = useState("");
  const [stationName, setStationName] = useState("");

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const tank = tanks.find((t) => t.id === tankId);

  if (phase === "driver") {
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <p className="label">Chauffeur</p>
          {scanTarget === "driver" ? (
            <QrScanner
              expected="driver"
              label="Scannez le badge du chauffeur"
              onScan={(p) => {
                setDriverId(p.id);
                setDriverLabel("Chauffeur scanné");
                setScanTarget(null);
              }}
            />
          ) : employees && employees.length > 0 ? (
            <div className="flex flex-col gap-2">
              <select aria-label="Chauffeur"
                className="input"
                value={driverId}
                onChange={(e) => {
                  const selected = employees.find((emp) => emp.id === e.target.value);
                  setDriverId(e.target.value);
                  setDriverLabel(selected?.full_name ?? "");
                }}
              >
                <option value="">Sélectionner un chauffeur…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name}
                  </option>
                ))}
              </select>
              <button className="btn-secondary self-start" onClick={() => setScanTarget("driver")}>
                📷 Ou scanner un badge
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-navy/70">{driverLabel}</span>
              <button className="btn-secondary shrink-0" onClick={() => setScanTarget("driver")}>
                📷 Borne partagée : scanner un badge
              </button>
            </div>
          )}
        </Card>

        <button className="btn-primary" disabled={!driverId} onClick={() => setPhase("vehicle")}>
          Continuer
        </button>
      </div>
    );
  }

  if (phase === "vehicle") {
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <p className="label">Véhicule</p>
          {vehicleLocked ? (
            <div className="flex items-center justify-between">
              <span className="text-sm text-navy/70">✅ {vehicle?.registration} ({vehicle?.type})</span>
              <button className="btn-secondary shrink-0" onClick={() => setVehicleLocked(false)}>
                Changer de véhicule
              </button>
            </div>
          ) : scanTarget === "vehicle" ? (
            <QrScanner
              expected="vehicle"
              label="Scannez le QR code du véhicule"
              onScan={(p) => {
                setVehicleId(p.id);
                setScanTarget(null);
              }}
            />
          ) : (
            <div className="flex gap-2">
              <select aria-label="Véhicule" className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Sélectionner…</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration} ({v.type})
                  </option>
                ))}
              </select>
              <button className="btn-secondary shrink-0" onClick={() => setScanTarget("vehicle")}>
                📷 Scanner
              </button>
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <p className="label">Cuve / pompe</p>
          {scanTarget === "tank" ? (
            <QrScanner
              expected="tank"
              label="Scannez le QR code de la cuve"
              onScan={(p) => {
                setTankId(p.id);
                setScanTarget(null);
              }}
            />
          ) : (
            <div className="flex gap-2">
              <select aria-label="Cuve" className="input" value={tankId} onChange={(e) => setTankId(e.target.value)}>
                <option value="">Sélectionner…</option>
                {tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.fuel_type})
                  </option>
                ))}
              </select>
              <button className="btn-secondary shrink-0" onClick={() => setScanTarget("tank")}>
                📷 Scanner
              </button>
            </div>
          )}
        </Card>

        <button className="btn-primary" disabled={!vehicleId || !tankId} onClick={() => setPhase("odometer")}>
          Continuer
        </button>
      </div>
    );
  }

  if (phase === "odometer") {
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-navy/70">
            {vehicle?.registration} · {tank?.name}
          </p>
          <div>
            <label className="block"><span className="label">Kilométrage du véhicule *</span>
            <input type="number" step="1" className="input" value={vehicleKm} onChange={(e) => setVehicleKm(e.target.value)} /></label>
            {ocrEnabled && (
              <div className="mt-1.5">
                <CounterPhotoCapture
                  label="Photo compteur kilométrique"
                  initUrl="/api/ocr/odometer/init"
                  processUrl="/api/ocr/odometer/process"
                  bucket="tour-photos"
                  onCaptured={({ photoPath, reading }) => {
                    setVehicleKmPhotoPath(photoPath);
                    if (reading !== null) setVehicleKm(String(reading));
                  }}
                />
              </div>
            )}
          </div>
        </Card>

        <button className="btn-primary" disabled={!vehicleKm} onClick={() => setPhase(ocrEnabled ? "capture-choice" : "tank-before")}>
          Continuer
        </button>
      </div>
    );
  }

  if (phase === "capture-choice") {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <p className="text-sm text-navy/70">
            {vehicle?.registration} · {tank?.name} · {vehicleKm} km
          </p>
        </Card>
        <button className="btn-primary" onClick={() => setPhase("ocr")}>
          📷 Photographier le ticket (OCR)
        </button>
        <button className="btn-secondary" onClick={() => setPhase("tank-before")}>
          ⛽ Plein cuve (totaliseur)
        </button>
      </div>
    );
  }

  if (phase === "ocr" && !ocrResult) {
    return <CameraCapture vehicleId={vehicleId} tankId={tankId} driverId={driverId} onResult={setOcrResult} />;
  }

  if (phase === "tank-before") {
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <p className="label">Index totaliseur avant (L)</p>
          <input aria-label="Index totaliseur avant (L)"
            type="number"
            step="0.01"
            className="input"
            value={totalizerBefore}
            onChange={(e) => setTotalizerBefore(e.target.value)}
          />
          {ocrEnabled && (
            <CounterPhotoCapture
              label="Photo totaliseur avant"
              initUrl="/api/ocr/totalizer/init"
              processUrl="/api/ocr/totalizer/process"
              bucket={FUEL_BUCKET}
              onCaptured={({ photoPath, reading }) => {
                setTotalizerBeforePhotoPath(photoPath);
                if (reading !== null) setTotalizerBefore(String(reading));
              }}
            />
          )}
        </Card>

        <button className="btn-primary" onClick={() => setPhase("tank-after")}>
          Continuer
        </button>
      </div>
    );
  }

  if (phase === "tank-after") {
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <p className="label">Index totaliseur après (L) *</p>
          <input aria-label="Index totaliseur après (L)"
            type="number"
            step="0.01"
            className="input"
            value={totalizerAfter}
            onChange={(e) => setTotalizerAfter(e.target.value)}
          />
          {ocrEnabled && (
            <CounterPhotoCapture
              label="Photo totaliseur après"
              initUrl="/api/ocr/totalizer/init"
              processUrl="/api/ocr/totalizer/process"
              bucket={FUEL_BUCKET}
              onCaptured={({ photoPath, reading }) => {
                setTotalizerAfterPhotoPath(photoPath);
                if (reading !== null) setTotalizerAfter(String(reading));
              }}
            />
          )}
        </Card>

        <button className="btn-primary" disabled={!totalizerAfter} onClick={() => setPhase("validate")}>
          Continuer
        </button>
      </div>
    );
  }

  async function submitManual() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fuel-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          tank_id: tankId,
          driver_id: driverId,
          occurred_at: new Date(occurredAt).toISOString(),
          totalizer_before: totalizerBefore ? Number(totalizerBefore) : null,
          totalizer_after: Number(totalizerAfter),
          totalizer_before_photo_path: totalizerBeforePhotoPath || undefined,
          totalizer_after_photo_path: totalizerAfterPhotoPath || undefined,
          vehicle_km: vehicleKm ? Number(vehicleKm) : undefined,
          vehicle_km_photo_path: vehicleKmPhotoPath || undefined,
          station_name: stationName || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      handleSubmitted(json.fuelEntry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function submitOcrConfirmation(values: FuelEntryFormValues, markManual = false) {
    if (!ocrResult) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fuel-entries/${ocrResult.fuelEntryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          tank_id: tankId,
          occurred_at: new Date(values.occurred_at).toISOString(),
          totalizer_before: values.totalizer_before ? Number(values.totalizer_before) : null,
          totalizer_after: Number(values.totalizer_after),
          totalizer_before_photo_path: values.totalizer_before_photo_path || undefined,
          totalizer_after_photo_path: values.totalizer_after_photo_path || undefined,
          vehicle_km: values.vehicle_km ? Number(values.vehicle_km) : undefined,
          vehicle_km_photo_path: vehicleKmPhotoPath || undefined,
          liters: Number(values.liters),
          unit_price: Number(values.unit_price),
          station_name: values.station_name || undefined,
          ...(markManual ? { markManual: true } : { validate: true }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      handleSubmitted(json.fuelEntry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  function handleSubmitted(fuelEntry: { gap_flagged?: boolean; totalizer_gap?: number }) {
    setPhase("submitted");
    if (fuelEntry?.gap_flagged) {
      setError(
        `⚠️ Écart de totaliseur détecté (${fuelEntry.totalizer_gap} L) — une alerte a été envoyée à votre manager.`,
      );
    }
  }

  if (phase === "ocr" && ocrResult) {
    if (ocrResult.status === "ocr_failed") {
      return (
        <FuelEntryForm
          ocrNotice={`Extraction OCR impossible (${ocrResult.ocrError ?? "raison inconnue"}). Complétez manuellement — la photo reste attachée pour l'audit.`}
          initialValues={{ vehicle_km: vehicleKm }}
          submitLabel="Enregistrer"
          busy={busy}
          totalizerOcrEnabled={ocrEnabled}
          showPriceFields
          onSubmit={(values) => submitOcrConfirmation(values, true)}
        />
      );
    }
    return (
      <FuelEntryForm
        ocrNotice="Ticket analysé — vérifiez les champs avant validation."
        initialValues={{
          occurred_at: ocrResult.extractedFields?.occurred_at?.slice(0, 16),
          liters: ocrResult.extractedFields?.liters?.toString(),
          unit_price: ocrResult.extractedFields?.unit_price?.toString(),
          station_name: ocrResult.extractedFields?.station_name,
          vehicle_km: vehicleKm,
        }}
        submitLabel="Valider et enregistrer"
        busy={busy}
        totalizerOcrEnabled={ocrEnabled}
        showPriceFields
        onSubmit={(values) => submitOcrConfirmation(values)}
      />
    );
  }

  if (phase === "validate") {
    const before = Number(totalizerBefore);
    const after = Number(totalizerAfter);
    const derivedLiters = totalizerBefore && after > before ? Math.round((after - before) * 100) / 100 : null;
    return (
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm text-navy/70">
          <p>
            {driverLabel} · {vehicle?.registration} · {tank?.name}
          </p>
          <p>Kilométrage : {vehicleKm} km</p>
          <p>
            Totaliseur : {totalizerBefore || "—"} → {totalizerAfter} L
            {derivedLiters !== null && <span className="font-medium text-navy"> ({derivedLiters} L)</span>}
          </p>
        </div>

        <div>
          <label className="block"><span className="label">Date et heure</span>
          <input type="datetime-local" className="input" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></label>
        </div>

        <div>
          <label className="block"><span className="label">Station (optionnel)</span>
          <input className="input" value={stationName} onChange={(e) => setStationName(e.target.value)} /></label>
        </div>

        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

        <button className="btn-primary" disabled={busy} onClick={submitManual}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </Card>
    );
  }

  if (phase === "submitted") {
    return (
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-lg">✅ Ravitaillement enregistré</p>
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        <button className="btn-primary" onClick={() => router.push("/fuel")}>
          Voir l&apos;historique
        </button>
      </Card>
    );
  }

  return error ? <p className="text-sm text-orange-ink">{error}</p> : null;
}
