"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { QrScanner } from "@/components/fuel/QrScanner";
import { CameraCapture, type OcrCaptureResult } from "@/components/fuel/CameraCapture";
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

type Phase = "select" | "capture-choice" | "ocr" | "manual" | "submitted";

export function NewFuelEntryWizard({
  vehicles,
  tanks,
  ocrEnabled,
  initialVehicleId,
  initialTankId,
  selfDriverId,
  selfDriverName,
}: {
  vehicles: VehicleOption[];
  tanks: TankOption[];
  ocrEnabled: boolean;
  initialVehicleId?: string;
  initialTankId?: string;
  selfDriverId: string;
  selfDriverName: string;
}) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? "");
  const [tankId, setTankId] = useState(initialTankId ?? "");
  const [driverId, setDriverId] = useState(selfDriverId);
  const [driverLabel, setDriverLabel] = useState(selfDriverName);
  const [scanTarget, setScanTarget] = useState<"vehicle" | "tank" | "driver" | null>(null);
  const [phase, setPhase] = useState<Phase>(vehicleId && tankId ? "capture-choice" : "select");
  const [ocrResult, setOcrResult] = useState<OcrCaptureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const tank = tanks.find((t) => t.id === tankId);

  if (phase === "select") {
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-3">
          <p className="label">Véhicule</p>
          {scanTarget === "vehicle" ? (
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
              <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
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
              <select className="input" value={tankId} onChange={(e) => setTankId(e.target.value)}>
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
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-navy/70">{driverLabel}</span>
              <button className="btn-secondary shrink-0" onClick={() => setScanTarget("driver")}>
                📷 Borne partagée : scanner un badge
              </button>
            </div>
          )}
        </Card>

        <button
          className="btn-primary"
          disabled={!vehicleId || !tankId}
          onClick={() => setPhase(ocrEnabled ? "capture-choice" : "manual")}
        >
          Continuer
        </button>
      </div>
    );
  }

  if (phase === "capture-choice") {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <p className="text-sm text-navy/60">
            {vehicle?.registration} · {tank?.name}
          </p>
        </Card>
        <button className="btn-primary" onClick={() => setPhase("ocr")}>
          📷 Photographier le ticket (OCR)
        </button>
        <button className="btn-secondary" onClick={() => setPhase("manual")}>
          ✏️ Saisie manuelle
        </button>
      </div>
    );
  }

  if (phase === "ocr" && !ocrResult) {
    return <CameraCapture vehicleId={vehicleId} tankId={tankId} driverId={driverId} onResult={setOcrResult} />;
  }

  async function submitManual(values: FuelEntryFormValues) {
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
          occurred_at: new Date(values.occurred_at).toISOString(),
          totalizer_before: values.totalizer_before ? Number(values.totalizer_before) : null,
          totalizer_after: Number(values.totalizer_after),
          totalizer_before_photo_path: values.totalizer_before_photo_path || undefined,
          totalizer_after_photo_path: values.totalizer_after_photo_path || undefined,
          vehicle_km: values.vehicle_km ? Number(values.vehicle_km) : undefined,
          liters: values.liters ? Number(values.liters) : undefined,
          unit_price: values.unit_price ? Number(values.unit_price) : undefined,
          station_name: values.station_name || undefined,
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
        }}
        submitLabel="Valider et enregistrer"
        busy={busy}
        totalizerOcrEnabled={ocrEnabled}
        showPriceFields
        onSubmit={(values) => submitOcrConfirmation(values)}
      />
    );
  }

  if (phase === "manual") {
    return <FuelEntryForm submitLabel="Enregistrer" busy={busy} totalizerOcrEnabled={ocrEnabled} onSubmit={submitManual} />;
  }

  if (phase === "submitted") {
    return (
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-lg">✅ Ravitaillement enregistré</p>
        {error && <p className="text-sm text-orange-ink">{error}</p>}
        <button className="btn-primary" onClick={() => router.push("/fuel")}>
          Voir l&apos;historique
        </button>
      </Card>
    );
  }

  return error ? <p className="text-sm text-orange-ink">{error}</p> : null;
}
