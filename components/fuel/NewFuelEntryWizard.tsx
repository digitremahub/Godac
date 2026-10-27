"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { QrScanner } from "@/components/fuel/QrScanner";
import { CameraCapture, type OcrCaptureResult } from "@/components/fuel/CameraCapture";
import { CounterPhotoCapture } from "@/components/shared/CounterPhotoCapture";
import { FuelEntryForm, type FuelEntryFormValues } from "@/components/fuel/FuelEntryForm";
import { ChampPhotoTicket } from "@/components/fuel/ChampPhotoTicket";
import { ConfirmerControles } from "@/components/fuel/ConfirmerControles";
import { CODE_CONTROLE_A_CONFIRMER, type ControleSaisie } from "@/lib/fuel/controles-saisie";
import { fuelEntryPayload, parseDecimal } from "@/lib/fuel/entry-payload";
import { joindreTicket } from "@/lib/fuel/ticket-client";
import { libelleCarburant } from "@/lib/fuel/vocabulaire";
import { libelleDernierReleve, phaseApresChauffeur, phaseInitiale, type Phase } from "@/lib/fuel/wizard";
import { fetchGodac } from "@/lib/http/fetch-godac";
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
  /** Dernier index du totaliseur connu pour la cuve : affiché comme repère, jamais pré-rempli (l'écart avec le plein précédent reste contrôlé). */
  current_totalizer_index?: number | string | null;
}
interface EmployeeOption {
  id: string;
  full_name: string;
}

/**
 * Follows the physical order of a real fill-up instead of one
 * all-fields-at-once screen. Ce qui est déjà connu ne se redemande pas :
 * le chauffeur connecté (ou le badge scanné) et son véhicule (affecté,
 * dernier utilisé ou QR scanné) sautent directement à l'odomètre, avec
 * un bandeau « Chauffeur · Véhicule [modifier] » (lib/fuel/wizard.ts).
 * Écrans : kilométrage et date du jour (toujours, avec le dernier
 * relevé connu), puis la branche achat en station (ticket photographié/OCR
 * ou saisi à la main : litres, prix, produit, photo facultative du ticket)
 * ou cuve (choix de la cuve, totaliseurs avant et après sur un seul écran),
 * puis validation. Un contrôle de cohérence en échec en fin de parcours
 * (kilométrage, réservoir) ne perd jamais la saisie : « confirmer et
 * signaler » avec un motif (components/fuel/ConfirmerControles.tsx).
 */

const FUEL_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? "fuel-tickets";

interface ControlesAConfirmer {
  controles: ControleSaisie[];
  rejouer: (motif: string) => Promise<void>;
}

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
  lastVehicleId,
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
  /** This driver's own assigned vehicle (vehicles.assigned_driver_id) — pré-sélectionné, l'écran véhicule est sauté (« Changer de véhicule » reste proposé). */
  assignedVehicleId?: string;
  /** Véhicule du dernier plein de cette personne : repris quand aucun véhicule n'est affecté ni scanné. */
  lastVehicleId?: string;
  selfDriverId: string;
  selfDriverName: string;
  /** False for manager/direction (never drivers themselves) — forces an explicit choice instead of defaulting to their own account, which would otherwise be submitted as the driver_id. */
  selfIsDriver: boolean;
  /** « J'entre le ravitaillement d'un collègue » — token from /api/tours/on-behalf; the driver is fixed to that colleague. */
  onBehalf?: { token: string; colleagueName: string };
}) {
  const router = useRouter();
  const vehiculeConnu = initialVehicleId ?? assignedVehicleId ?? (lastVehicleId && vehicles.some((v) => v.id === lastVehicleId) ? lastVehicleId : undefined);
  const [vehicleId, setVehicleId] = useState(vehiculeConnu ?? "");
  const [tankId, setTankId] = useState(initialTankId ?? "");
  const [driverId, setDriverId] = useState(initialDriverId ?? (selfIsDriver ? selfDriverId : ""));
  const [driverLabel, setDriverLabel] = useState(initialDriverName ?? (selfIsDriver ? selfDriverName : ""));
  const [scanTarget, setScanTarget] = useState<"vehicle" | "tank" | "driver" | null>(null);
  // Chauffeur et véhicule déjà connus : l'assistant démarre au kilométrage. Un seul élément connu
  // ne saute que son propre écran.
  const [phase, setPhase] = useState<Phase>(() => phaseInitiale({ chauffeur: Boolean(initialDriverId ?? (selfIsDriver ? selfDriverId : "")), vehicule: Boolean(vehiculeConnu) }));
  const [ocrResult, setOcrResult] = useState<OcrCaptureResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aConfirmer, setAConfirmer] = useState<ControlesAConfirmer | null>(null);
  const [signale, setSignale] = useState(false);
  const [ticketFile, setTicketFile] = useState<File | null>(null);
  const [avertissementPhoto, setAvertissementPhoto] = useState<string | null>(null);
  const [dernierReleve, setDernierReleve] = useState<{ km: number; at: string } | null | undefined>(undefined);

  // Date du jour pré-remplie à l'étape du kilométrage : elle sert à tous les écrans qui suivent.
  const [occurredAt, setOccurredAt] = useState(() => toDatetimeLocalValue());
  const [vehicleKm, setVehicleKm] = useState("");
  const [vehicleKmPhotoPath, setVehicleKmPhotoPath] = useState("");
  const [totalizerBefore, setTotalizerBefore] = useState("");
  const [totalizerBeforePhotoPath, setTotalizerBeforePhotoPath] = useState("");
  const [totalizerAfter, setTotalizerAfter] = useState("");
  const [totalizerAfterPhotoPath, setTotalizerAfterPhotoPath] = useState("");

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const tank = tanks.find((t) => t.id === tankId);

  // Dernier kilométrage connu du véhicule, affiché à l'étape du kilométrage.
  useEffect(() => {
    if (phase !== "odometer" || !vehicleId) return;
    let annule = false;
    setDernierReleve(undefined);
    fetchGodac<{ dernierKm: { km: number; at: string } | null }>(`/api/fuel-entries/contexte?vehicle_id=${encodeURIComponent(vehicleId)}`).then((r) => {
      if (!annule) setDernierReleve(r.ok ? r.data.dernierKm : null);
    });
    return () => {
      annule = true;
    };
  }, [phase, vehicleId]);

  /**
   * Envoi d'un plein. Un contrôle de cohérence en échec (409 CONTROLE_A_CONFIRMER)
   * garde l'écran et propose « confirmer et signaler » ; la requête est rejouée
   * telle quelle avec le motif. Jamais de saisie perdue.
   */
  async function appeler(requete: (motif?: string) => Promise<Response>, motif?: string, apres?: (json: { fuelEntry?: { id?: string } }) => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      const res = await requete(motif);
      const json = await res.json();
      if (res.status === 409 && json.code === CODE_CONTROLE_A_CONFIRMER && Array.isArray(json.controles)) {
        setAConfirmer({ controles: json.controles, rejouer: (m) => appeler(requete, m, apres) });
        if (motif) setError(typeof json.error === "string" ? json.error : null);
        return;
      }
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Données refusées — vérifiez les champs.");
      setAConfirmer(null);
      setSignale(Boolean(motif));
      await apres?.(json);
      handleSubmitted(json.fuelEntry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  const enTetes = { "Content-Type": "application/json", ...(onBehalf ? { "x-godac-on-behalf": onBehalf.token } : {}) };
  const confirmation = (motif?: string) => (motif ? { confirmer_controles: { motif } } : {});

  const panneauControles = aConfirmer && (
    <ConfirmerControles controles={aConfirmer.controles} busy={busy} onConfirmer={(m) => aConfirmer.rejouer(m)} onCorriger={() => setAConfirmer(null)} />
  );

  /** Bandeau « Chauffeur · Véhicule [modifier] » des écrans qui suivent le choix de l'un et de l'autre. */
  const recapitulatif = (
    <Card className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-navy/80">
        <span className="font-medium text-navy">{driverLabel || "Chauffeur"}</span> · {vehicle?.registration}
        {tank && ` · ${tank.name}`}
      </p>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="btn-ghost min-h-[44px] text-sm"
          onClick={() => {
            setScanTarget(null);
            setPhase("vehicle");
          }}
        >
          Changer de véhicule
        </button>
        {!onBehalf && (
          <button
            type="button"
            className="btn-ghost min-h-[44px] text-sm"
            onClick={() => {
              setScanTarget(null);
              setPhase("driver");
            }}
          >
            Changer de chauffeur
          </button>
        )}
      </div>
    </Card>
  );

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
                className="input min-h-[44px]"
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
              <button className="btn-secondary min-h-[44px] self-start" onClick={() => setScanTarget("driver")}>
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Ou scanner un badge
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-navy/70">{driverLabel}</span>
              <button className="btn-secondary min-h-[44px] shrink-0" onClick={() => setScanTarget("driver")}>
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Borne partagée : scanner un badge
              </button>
            </div>
          )}
        </Card>

        <button className="btn-primary min-h-[44px]" disabled={!driverId} onClick={() => setPhase(phaseApresChauffeur({ vehicule: Boolean(vehicleId) }))}>
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
              <select aria-label="Véhicule" className="input min-h-[44px]" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Sélectionner…</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration} ({v.type})
                  </option>
                ))}
              </select>
              <button className="btn-secondary min-h-[44px] shrink-0" onClick={() => setScanTarget("vehicle")}>
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Scanner
              </button>
            </div>
          )}
        </Card>

        <button className="btn-primary min-h-[44px]" disabled={!vehicleId} onClick={() => setPhase("odometer")}>
          Continuer
        </button>
      </div>
    );
  }

  if (phase === "odometer") {
    const dernier = libelleDernierReleve(dernierReleve);
    return (
      <div className="flex flex-col gap-4">
        {recapitulatif}
        <Card className="flex flex-col gap-3">
          <div>
            <label className="block"><span className="label">Kilométrage du véhicule *</span>
            <input type="number" inputMode="numeric" step="1" className="input min-h-[44px]" value={vehicleKm} onChange={(e) => setVehicleKm(e.target.value)} /></label>
            {dernier ? (
              <p className="mt-1 text-xs text-navy/60">Dernier relevé connu : {dernier}.</p>
            ) : dernierReleve === null ? (
              <p className="mt-1 text-xs text-navy/60">Aucun relevé connu pour ce véhicule.</p>
            ) : null}
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
          <div>
            <label className="block"><span className="label">Date et heure du plein</span>
            <input type="datetime-local" className="input min-h-[44px]" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></label>
            <p className="mt-1 text-xs text-navy/60">Aujourd&apos;hui par défaut ; changez-la pour un plein oublié.</p>
          </div>
        </Card>

        <button className="btn-primary min-h-[44px]" disabled={!vehicleKm || !datetimeLocalToIso(occurredAt)} onClick={() => setPhase("capture-choice")}>
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
              <button className="btn-primary min-h-[44px]" onClick={() => setPhase("ocr")}>
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Photographier le ticket (OCR)
              </button>
            )}
            <button className={`${ocrEnabled ? "btn-secondary" : "btn-primary"} min-h-[44px]`} onClick={() => setPhase("station")}>
              Saisir le ticket à la main
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <p className="label">Cuve de l&apos;entreprise</p>
            <button className="btn-secondary min-h-[44px]" onClick={() => setPhase(tankId ? "tank-totalizers" : "tank")}>
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
              <select aria-label="Cuve" className="input min-h-[44px]" value={tankId} onChange={(e) => setTankId(e.target.value)}>
                <option value="">Sélectionner…</option>
                {tanks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({libelleCarburant(t.fuel_type)})
                  </option>
                ))}
              </select>
              <button className="btn-secondary min-h-[44px] shrink-0" onClick={() => setScanTarget("tank")}>
                <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Scanner
              </button>
            </div>
          )}
        </Card>

        <button className="btn-primary min-h-[44px]" disabled={!tankId} onClick={() => setPhase("tank-totalizers")}>
          Continuer
        </button>
      </div>
    );
  }

  if (phase === "tank-totalizers") {
    const indexConnu = tank?.current_totalizer_index != null && tank.current_totalizer_index !== "" ? Number(tank.current_totalizer_index) : null;
    return (
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4">
          <p className="text-sm text-navy/70">
            {tank?.name}
            {indexConnu !== null && Number.isFinite(indexConnu) && <span className="block text-xs text-navy/60">Dernier index connu de la cuve : {indexConnu.toLocaleString("fr-FR")} L (repère : relevez celui du compteur).</span>}
          </p>
          <div className="flex flex-col gap-2">
            <label className="block"><span className="label">Index totaliseur avant (L)</span>
            <input type="number" inputMode="decimal" step="0.01" className="input min-h-[44px]" value={totalizerBefore} onChange={(e) => setTotalizerBefore(e.target.value)} /></label>
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
          </div>
          <div className="flex flex-col gap-2">
            <label className="block"><span className="label">Index totaliseur après (L) *</span>
            <input type="number" inputMode="decimal" step="0.01" className="input min-h-[44px]" value={totalizerAfter} onChange={(e) => setTotalizerAfter(e.target.value)} /></label>
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
          </div>
        </Card>

        <button className="btn-primary min-h-[44px]" disabled={!totalizerAfter} onClick={() => setPhase("validate")}>
          Continuer
        </button>
      </div>
    );
  }

  /** Plein à la cuve : totaliseur avant / après. */
  function submitManual(motif?: string) {
    return appeler(
      (m) =>
        fetch("/api/fuel-entries", {
          method: "POST",
          headers: enTetes,
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
            ...confirmation(m),
          }),
        }),
      motif,
    );
  }

  /** Ticket OCR relu et validé (ou complété à la main : markManual). */
  function submitOcrConfirmation(values: FuelEntryFormValues, markManual = false, motif?: string) {
    if (!ocrResult) return Promise.resolve();
    return appeler(
      (m) =>
        fetch(`/api/fuel-entries/${ocrResult.fuelEntryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // Ticket de station : ni cuve ni totaliseur (tank_id: null).
          body: JSON.stringify({
            ...fuelEntryPayload(values, { station: true, method: "PATCH" }),
            vehicle_id: vehicleId,
            vehicle_km_photo_path: vehicleKmPhotoPath || undefined,
            ...(markManual ? { markManual: true } : { validate: true }),
            ...confirmation(m),
          }),
        }),
      motif,
    );
  }

  /** Achat en station saisi à la main (ticket en main, sans photo / OCR désactivé) ; la photo du ticket, facultative, est jointe une fois le plein enregistré. */
  function submitStation(values: FuelEntryFormValues, motif?: string) {
    return appeler(
      (m) =>
        fetch("/api/fuel-entries", {
          method: "POST",
          headers: enTetes,
          body: JSON.stringify({
            ...fuelEntryPayload(values, { station: true, method: "POST" }),
            vehicle_id: vehicleId,
            driver_id: driverId,
            vehicle_km_photo_path: vehicleKmPhotoPath || undefined,
            ...confirmation(m),
          }),
        }),
      motif,
      async (json) => {
        if (!ticketFile || !json.fuelEntry?.id) return;
        const r = await joindreTicket(json.fuelEntry.id, ticketFile);
        if (!r.ok) setAvertissementPhoto(`${r.message} Le plein est enregistré : joignez le ticket depuis la liste des pleins.`);
      },
    );
  }

  function handleSubmitted(fuelEntry?: { gap_flagged?: boolean; totalizer_gap?: number }) {
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
            initialValues={{ vehicle_km: vehicleKm, occurred_at: occurredAt }}
            submitLabel="Enregistrer"
            busy={busy}
            station
            hideKm
            bas={panneauControles}
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
            // ISO (UTC) stocké → heure locale de l'input ; sans date lue, la date du plein saisie au kilométrage.
            occurred_at: isoToDatetimeLocal(extracted?.occurred_at) || occurredAt,
            liters: extracted?.liters?.toString(),
            unit_price: extracted?.unit_price?.toString(),
            station_name: extracted?.station_name,
            vehicle_km: vehicleKm,
          }}
          ticket={extracted ? { total_amount: extracted.total_amount ?? null, fuel_type: extracted.fuel_type ?? null } : null}
          submitLabel="Valider et enregistrer"
          busy={busy}
          station
          hideKm
          bas={panneauControles}
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
          initialValues={{ vehicle_km: vehicleKm, occurred_at: occurredAt }}
          submitLabel="Enregistrer"
          busy={busy}
          station
          hideKm
          hideDate
          bas={
            <>
              <ChampPhotoTicket fichier={ticketFile} onChange={setTicketFile} />
              {panneauControles}
            </>
          }
          onSubmit={(values) => submitStation(values)}
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
          <p>
            Le {new Date(datetimeLocalToIso(occurredAt) ?? Date.now()).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })} · {vehicleKm} km
          </p>
          <p>
            Totaliseur : {totalizerBefore || "—"} → {totalizerAfter} L
            {derivedLiters !== null && <span className="font-medium text-navy"> ({derivedLiters} L)</span>}
          </p>
        </div>

        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        {panneauControles}

        <button className="btn-primary min-h-[44px]" disabled={busy} onClick={() => submitManual()}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </Card>
    );
  }

  if (phase === "submitted") {
    return (
      <Card className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-lg"><IconCheck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Plein enregistré</p>
        {signale && <p className="text-sm text-navy/70">Le contrôle confirmé et votre motif ont été signalés à votre encadrement.</p>}
        {avertissementPhoto && <p role="alert" className="text-sm text-orange-ink">{avertissementPhoto}</p>}
        {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        <button className="btn-primary min-h-[44px]" onClick={() => router.push("/carburant/pleins")}>
          Voir l&apos;historique
        </button>
      </Card>
    );
  }

  return error ? <p className="text-sm text-orange-ink">{error}</p> : null;
}
