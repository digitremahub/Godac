"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { QrScanner } from "@/components/fuel/QrScanner";
import { StartTourFlow } from "@/components/tours/StartTourFlow";
import { EndTourFlow } from "@/components/tours/EndTourFlow";
import { NewFuelEntryWizard } from "@/components/fuel/NewFuelEntryWizard";
import { IconArrowRight, IconDroplet, IconFlag, IconTruck, IconUsers } from "@/components/layout/icons";

type Step =
  | { kind: "scan" }
  | { kind: "pin"; colleagueId: string }
  | { kind: "act"; token: string; colleagueId: string; colleagueName: string; hasOpenTour: boolean; action: "tour" | "fuel" | null };

/**
 * « J'entre le départ / retour / ravitaillement d'un collègue »: scan
 * the colleague's badge (or type their driver code), they enter THEIR
 * PIN on this phone, then the usual start/end or fuel flow runs on
 * their behalf — the server records who entered it
 * (planning_entries.started_by / ended_by, fuel_entries.created_by).
 * See lib/tours/on-behalf.ts.
 */
export function HelpColleagueFlow({
  initialVehicleId,
  requireOdometerPhoto,
  planningEnabled,
  vehicles,
  tanks,
}: {
  initialVehicleId?: string;
  requireOdometerPhoto: boolean;
  planningEnabled: boolean;
  vehicles: { id: string; registration: string; type: string }[];
  tanks: { id: string; name: string; fuel_type: string }[];
}) {
  const [step, setStep] = useState<Step>({ kind: "scan" });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "pin") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tours/on-behalf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colleague_id: step.colleagueId, pin }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Vérification impossible.");
      setPin("");
      setStep({
        kind: "act",
        token: json.token,
        colleagueId: json.colleague.id,
        colleagueName: json.colleague.full_name,
        hasOpenTour: json.hasOpenTour,
        action: planningEnabled ? null : "fuel",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "act") {
    const onBehalf = { token: step.token, colleagueName: step.colleagueName };
    const banner = (
      <div className="flex items-center gap-3 rounded-xl bg-marine px-4 py-3 text-white">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal text-marine">
          <IconUsers className="h-5 w-5" />
        </span>
        <p className="text-sm">
          Vous saisissez pour <strong>{step.colleagueName}</strong>. Tout sera enregistré à son nom.
        </p>
      </div>
    );

    if (step.action === null) {
      const choices = [
        {
          action: "tour" as const,
          icon: step.hasOpenTour ? IconFlag : IconTruck,
          title: step.hasOpenTour ? "Son retour" : "Son départ",
          hint: step.hasOpenTour ? "Clôturer sa tournée en cours" : "Ouvrir sa tournée du jour",
        },
        { action: "fuel" as const, icon: IconDroplet, title: "Son ravitaillement", hint: "Plein cuve ou station, à son nom" },
      ];
      return (
        <div className="flex flex-col gap-4">
          {banner}
          <ul className="flex flex-col gap-3">
            {choices.map((c) => (
              <li key={c.action}>
                <button
                  type="button"
                  onClick={() => setStep({ ...step, action: c.action })}
                  className="card-hover flex w-full items-center gap-4 text-left"
                >
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-marine text-teal">
                    <c.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{c.title}</span>
                    <span className="block text-sm text-navy/65">{c.hint}</span>
                  </span>
                  <IconArrowRight className="h-5 w-5 shrink-0 text-navy/50" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {banner}
        {step.action === "fuel" ? (
          <NewFuelEntryWizard
            vehicles={vehicles}
            tanks={tanks}
            // OCR runs through separate upload routes that act as the
            // signed-in user — the colleague's entry stays manual.
            ocrEnabled={false}
            initialVehicleId={initialVehicleId}
            initialDriverId={step.colleagueId}
            initialDriverName={step.colleagueName}
            selfDriverId={step.colleagueId}
            selfDriverName={step.colleagueName}
            selfIsDriver
            onBehalf={onBehalf}
          />
        ) : step.hasOpenTour ? (
          <EndTourFlow initialVehicleId={initialVehicleId} requireOdometerPhoto={requireOdometerPhoto} onBehalf={onBehalf} />
        ) : (
          <StartTourFlow initialVehicleId={initialVehicleId} requireOdometerPhoto={requireOdometerPhoto} onBehalf={onBehalf} />
        )}
      </div>
    );
  }

  if (step.kind === "pin") {
    return (
      <Card>
        <form onSubmit={verify} className="flex flex-col gap-4">
          <div>
            <h2>Code PIN du collègue</h2>
            <p className="mt-1 text-sm text-navy/65">
              Tendez le téléphone à votre collègue : il saisit lui-même son code PIN. Rien n&apos;est enregistré sur cet appareil.
            </p>
          </div>
          <label className="block">
            <span className="label">Son code PIN</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              className="input text-center text-lg tracking-[0.5em]"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-describedby="help-pin-hint"
            />
          </label>
          <p id="help-pin-hint" className="-mt-2 text-xs text-navy/60">
            4 à 6 chiffres.
          </p>
          {error && (
            <p role="alert" className="text-sm text-orange-ink">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" className="btn-primary flex-1" disabled={busy || pin.length < 4}>
              {busy ? "Vérification…" : "Valider"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPin("");
                setError(null);
                setStep({ kind: "scan" });
              }}
            >
              Autre badge
            </button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col items-center gap-4 text-center">
      <div>
        <h2>Badge du collègue</h2>
        <p className="mt-1 text-sm text-navy/65">
          Scannez le badge QR de votre collègue, ou saisissez son code chauffeur.
        </p>
      </div>
      <QrScanner
        expected="driver"
        label="Badge du collègue"
        onScan={(payload) => {
          setError(null);
          setStep({ kind: "pin", colleagueId: payload.id });
        }}
      />
    </Card>
  );
}
