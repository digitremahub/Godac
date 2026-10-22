"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { QrScanner } from "@/components/fuel/QrScanner";
import { CameraCapture, type OcrCaptureResult } from "@/components/fuel/CameraCapture";
import { CounterPhotoCapture } from "@/components/shared/CounterPhotoCapture";
import { FuelEntryForm, type FuelEntryFormValues } from "@/components/fuel/FuelEntryForm";
import { fuelEntryPayload, parseDecimal } from "@/lib/fuel/entry-payload";
import { datetimeLocalToIso, isoToDatetimeLocal, toDatetimeLocalValue } from "@/lib/utils/datetime-local";
import { IconCamera, IconCheck, IconDroplet } from "@/components/layout/icons";

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
 * station ou d'un plein cuve), puis la branche achat en station
 * (ticket photographié/OCR ou saisi à la main : litres, prix, produit,
 * sans cuve ni totaliseur) ou cuve (choix de la cuve, totaliseur
 * avant/après), puis validation.
 */
type Phase =
  | "driver"
  | "vehicle"
  | "odometer"
  | "capture-choice"
  | "ocr"
  | "station"
  | "tank"
  | "tank-before"
  | "tank-after"
  | "validate"
  | "submitted";

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
  onBehalf,
}: {
  vehicles: VehicleOption[];
  tanks: TankOption[];
  /** Tous les chauffeurs/manager_chauffeur actifs — fourni uniquement aux rôles autorisés à saisir un plein pour quelqu'un d'autre (manager/direction), pour une saisie de secours (téléphone en panne, urgence) sans badge à scanner. */
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
  /** « J'entre le ravitaillement d'un collègue » — token from /api/tours/on-behalf; the driver is fixed to that colleague. */
  onBehalf?: { token: string; colleagueName: string };
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

  const [occurredAt, setOccurredAt] = useState(() => toDatetimeLocalValue());
  const [vehicleKm, setVehicleKm] = useState("");
  const [vehicleKmPhotoPath, setVehicleKmPhotoPath] = useState("");
  const [totalizerBefore, setTotalizerBefore] = useState("");
  const [totalizerBeforePhotoPath, setTotalizerBeforePhotoPath] = useState("");
  const [totalizerAfter, setTotalizerAfter] = useState("");
  const [totalizerAfterPhotoPath, setTotalizerAfterPhotoPath] = useState("");

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
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Ou scanner un badge
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-navy/70">{driverLabel}</span>
              <button className="btn-secondary shrink-0" onClick={() => setScanTarget("driver")}>
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Borne partagée : scanner un badge
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
              <span className="text-sm text-navy/70"><IconCheck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> {vehicle?.registration} ({vehicle?.type})</span>
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
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Scanner
              </button>
            </div>
          )}
        </Card>

        <button className="btn-primary" disabled={!vehicleId} onClick={() => setPhase("odometer")}>
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
            {vehicle?.registration}
            {tank && ` · ${tank.name}`}
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

        <button className="btn-primary" disabled={!vehicleKm} onClick={() => setPhase("capture-choice")}>
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
            {vehicle?.registration} · {vehicleKm} km
          </p>
        </Card>
        {/* Cuve scannée (QR) : le plein cuve passe en premier. */}
        <div className={`flex gap-4 ${initialTankId ? "flex-col-reverse" : "flex-col"}`}>
          <div className="flex flex-col gap-2">
            <p className="label">Achat en station</p>
            {ocrEnabled && (
              <button className="btn-primary" onClick={() => setPhase("ocr")}>
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Photographier le ticket (OCR)
              </button>
            )}
            <button className={ocrEnabled ? "btn-secondary" : "btn-primary"} onClick={() => setPhase("station")}>
              Saisir le ticket à la main
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <p className="label">Cuve de l&apos;entreprise</p>
            <button className="btn-secondary" onClick={() => setPhase(tankId ? "tank-before" : "tank")}>
              <IconDroplet className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Plein cuve (totaliseur)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "ocr" && !ocrResult) {
    // Ticket de station : aucune cuve rattachée.
    return <CameraCapture vehicleId={vehicleId} driverId={driverId} onResult={setOcrResult} />;
  }

  if (phase === "tank") {
    return (
      <div className="flex flex-col gap-4">
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
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Scanner
              </button>
            </div>
          )}
        </Card>

        <button className="btn-primary" disabled={!tankId} onClick={() => setPhase("tank-before")}>
          Continuer
        </button>
      </div>
    );
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
        headers: { "Content-Type": "application/json", ...(onBehalf ? { "x-godac-on-behalf": onBehalf.token } : {}) },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          tank_id: tankId,
          driver_id: driverId,
          occurred_at: datetimeLocalToIso(occurredAt),
          totalizer_before: parseDecimal(totalizerBefore),
          totalizer_after: parseDecimal(totalizerAfter) ?? undefined,
          totalizer_before_photo_path: totalizerBeforePhotoPath || undefined,
          totalizer_after_photo_path: totalizerAfterPhotoPath || undefined,
          vehicle_km: vehicleKm ? Number(vehicleKm) : undefined,
          vehicle_km_photo_path: vehicleKmPhotoPath || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Données refusées — vérifiez les champs.");
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
        // Ticket de station : ni cuve ni totaliseur (tank_id: null).
        body: JSON.stringify({
          ...fuelEntryPayload(values, { station: true, method: "PATCH" }),
          vehicle_id: vehicleId,
          vehicle_km_photo_path: vehicleKmPhotoPath || undefined,
          ...(markManual ? { markManual: true } : { validate: true }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Données refusées — vérifiez les champs.");
      handleSubmitted(json.fuelEntry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  /** Achat en station saisi à la main (ticket en main, sans photo / OCR désactivé). */
  async function submitStation(values: FuelEntryFormValues) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fuel-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(onBehalf ? { "x-godac-on-behalf": onBehalf.token } : {}) },
        body: JSON.stringify({
          ...fuelEntryPayload(values, { station: true, method: "POST" }),
          vehicle_id: vehicleId,
          driver_id: driverId,
          vehicle_km_photo_path: vehicleKmPhotoPath || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Données refusées — vérifiez les champs.");
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
        `Écart de totaliseur détecté (${fuelEntry.totalizer_gap} L) — une alerte a été envoyée à votre manager.`,
      );
    }
  }

  if (phase === "ocr" && ocrResult) {
    if (ocrResult.status === "ocr_failed") {
      return (
        <div className="flex flex-col gap-2">
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <FuelEntryForm
            ocrNotice={`Extraction OCR impossible (${ocrResult.ocrError ?? "raison inconnue"}). Complétez manuellement — la photo reste attachée pour l'audit.`}
            initialValues={{ vehicle_km: vehicleKm }}
            submitLabel="Enregistrer"
            busy={busy}
            station
            onSubmit={(values) => submitOcrConfirmation(values, true)}
          />
        </div>
      );
    }
    const extracted = ocrResult.extractedFields;
    return (
      <div className="flex flex-col gap-2">
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        <FuelEntryForm
          ocrNotice="Ticket analysé — vérifiez les champs avant validation."
          initialValues={{
            // ISO (UTC) stocké → heure locale de l'input.
            occurred_at: isoToDatetimeLocal(extracted?.occurred_at) || undefined,
            liters: extracted?.liters?.toString(),
            unit_price: extracted?.unit_price?.toString(),
            station_name: extracted?.station_name,
            vehicle_km: vehicleKm,
          }}
          ticket={extracted ? { total_amount: extracted.total_amount ?? null, fuel_type: extracted.fuel_type ?? null } : null}
          submitLabel="Valider et enregistrer"
          busy={busy}
          station
          onSubmit={(values) => submitOcrConfirmation(values)}
        />
      </div>
    );
  }

  if (phase === "station") {
    return (
      <div className="flex flex-col gap-2">
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        <FuelEntryForm
          ocrNotice="Achat en station : reportez les litres, le prix au litre et le produit indiqués sur le ticket."
          initialValues={{ vehicle_km: vehicleKm }}
          submitLabel="Enregistrer"
          busy={busy}
          station
          onSubmit={submitStation}
        />
      </div>
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
        <p className="text-lg"><IconCheck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Plein enregistré</p>
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        <button className="btn-primary" onClick={() => router.push("/carburant/pleins")}>
          Voir l&apos;historique
        </button>
      </Card>
    );
  }

  return error ? <p className="text-sm text-orange-ink">{error}</p> : null;
}
