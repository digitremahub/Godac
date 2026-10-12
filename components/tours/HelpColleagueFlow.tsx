"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { QrScanner } from "@/components/fuel/QrScanner";
import { StartTourFlow } from "@/components/tours/StartTourFlow";
import { EndTourFlow } from "@/components/tours/EndTourFlow";
import { IconUsers } from "@/components/layout/icons";

type Step =
  | { kind: "scan" }
  | { kind: "pin"; colleagueId: string }
  | { kind: "act"; token: string; colleagueName: string; hasOpenTour: boolean };

/**
 * « Dépanner un collègue »: scan the colleague's badge (or type their
 * driver code), they enter THEIR PIN on this phone, then the usual
 * start/end flow runs on their behalf — the server records who helped
 * (planning_entries.started_by / ended_by). See lib/tours/on-behalf.ts.
 */
export function HelpColleagueFlow({
  initialVehicleId,
  requireOdometerPhoto,
}: {
  initialVehicleId?: string;
  requireOdometerPhoto: boolean;
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
      setStep({ kind: "act", token: json.token, colleagueName: json.colleague.full_name, hasOpenTour: json.hasOpenTour });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === "act") {
    const onBehalf = { token: step.token, colleagueName: step.colleagueName };
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-xl bg-navy px-4 py-3 text-white">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal text-navy">
            <IconUsers className="h-5 w-5" />
          </span>
          <p className="text-sm">
            Vous agissez pour <strong>{step.colleagueName}</strong> —{" "}
            {step.hasOpenTour ? "enregistrement de son retour." : "enregistrement de son départ."}
          </p>
        </div>
        {step.hasOpenTour ? (
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
