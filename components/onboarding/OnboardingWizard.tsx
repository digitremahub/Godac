"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import {
  parseCsv,
  vehicleCsvRowSchema,
  driverCsvRowSchema,
  type VehicleCsvRow,
  type DriverCsvRow,
} from "@/lib/utils/csv";
import { PLANS } from "@/lib/stripe/plans";

type Step = "import" | "tanks" | "plan" | "done";

interface TankDraft {
  name: string;
  fuel_type: "diesel" | "adblue";
  capacity_liters: string;
  current_totalizer_index: string;
}

export function OnboardingWizard({ stripeStatus }: { stripeStatus?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(stripeStatus === "success" ? "done" : "import");
  const [vehicles, setVehicles] = useState<VehicleCsvRow[]>([]);
  const [drivers, setDrivers] = useState<DriverCsvRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [tanks, setTanks] = useState<TankDraft[]>([
    { name: "Cuve Gasoil", fuel_type: "diesel", capacity_liters: "", current_totalizer_index: "0" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(kind: "vehicles" | "drivers", file: File) {
    const text = await file.text();
    if (kind === "vehicles") {
      const { rows, errors } = parseCsv(text, vehicleCsvRowSchema);
      setVehicles(rows);
      setCsvErrors(errors.map((e) => `Véhicules L${e.row}: ${e.message}`));
    } else {
      const { rows, errors } = parseCsv(text, driverCsvRowSchema);
      setDrivers(rows);
      setCsvErrors((prev) => [...prev, ...errors.map((e) => `Chauffeurs L${e.row}: ${e.message}`)]);
    }
  }

  async function submitImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles, drivers }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur import");
      setStep("tanks");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function submitTanks() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/tanks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tanks: tanks
            .filter((t) => t.name && t.capacity_liters)
            .map((t) => ({
              ...t,
              capacity_liters: Number(t.capacity_liters),
              current_totalizer_index: Number(t.current_totalizer_index || 0),
            })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur cuves");
      setStep("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function choosePlan(planId: "starter" | "pro") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur Stripe");
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Configuration de votre espace GODAC"
        description="Trois étapes rapides avant de démarrer."
      />
      <StepIndicator step={step} />

      {error && (
        <Card className="mb-4 border-orange/40 bg-orange/10 text-orange">{error}</Card>
      )}

      {step === "import" && (
        <Card className="flex flex-col gap-6">
          <div>
            <p className="label">Véhicules (CSV: registration, type, tank_capacity_liters, service)</p>
            <input
              type="file"
              accept=".csv"
              className="input"
              onChange={(e) => e.target.files?.[0] && handleFile("vehicles", e.target.files[0])}
            />
            {vehicles.length > 0 && <p className="mt-1 text-sm text-teal">{vehicles.length} véhicule(s) prêt(s)</p>}
          </div>
          <div>
            <p className="label">Chauffeurs / équipe (CSV: full_name, email, role, service)</p>
            <input
              type="file"
              accept=".csv"
              className="input"
              onChange={(e) => e.target.files?.[0] && handleFile("drivers", e.target.files[0])}
            />
            {drivers.length > 0 && <p className="mt-1 text-sm text-teal">{drivers.length} invitation(s) prête(s)</p>}
          </div>
          {csvErrors.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-orange">
              {csvErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setStep("tanks")}>
              Passer cette étape
            </button>
            <button className="btn-primary" disabled={busy} onClick={submitImport}>
              {busy ? "Import en cours…" : "Importer et continuer"}
            </button>
          </div>
        </Card>
      )}

      {step === "tanks" && (
        <Card className="flex flex-col gap-4">
          <p className="text-white/70">
            Vos véhicules partagent des cuves internes — c&apos;est sur l&apos;index de
            ces cuves que GODAC détecte les écarts de ravitaillement, pas sur le
            kilométrage.
          </p>
          {tanks.map((tank, i) => (
            <div key={i} className="grid grid-cols-4 gap-3">
              <input
                className="input"
                placeholder="Nom (ex: Cuve Gasoil A)"
                value={tank.name}
                onChange={(e) =>
                  setTanks((prev) => prev.map((t, idx) => (idx === i ? { ...t, name: e.target.value } : t)))
                }
              />
              <select
                className="input"
                value={tank.fuel_type}
                onChange={(e) =>
                  setTanks((prev) =>
                    prev.map((t, idx) => (idx === i ? { ...t, fuel_type: e.target.value as "diesel" | "adblue" } : t)),
                  )
                }
              >
                <option value="diesel">Diesel</option>
                <option value="adblue">AdBlue</option>
              </select>
              <input
                className="input"
                type="number"
                placeholder="Capacité (L)"
                value={tank.capacity_liters}
                onChange={(e) =>
                  setTanks((prev) => prev.map((t, idx) => (idx === i ? { ...t, capacity_liters: e.target.value } : t)))
                }
              />
              <input
                className="input"
                type="number"
                placeholder="Index totaliseur actuel"
                value={tank.current_totalizer_index}
                onChange={(e) =>
                  setTanks((prev) =>
                    prev.map((t, idx) => (idx === i ? { ...t, current_totalizer_index: e.target.value } : t)),
                  )
                }
              />
            </div>
          ))}
          <button
            className="btn-secondary self-start"
            onClick={() =>
              setTanks((prev) => [
                ...prev,
                { name: "", fuel_type: "diesel", capacity_liters: "", current_totalizer_index: "0" },
              ])
            }
          >
            + Ajouter une cuve
          </button>
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setStep("plan")}>
              Passer cette étape
            </button>
            <button className="btn-primary" disabled={busy} onClick={submitTanks}>
              {busy ? "Enregistrement…" : "Enregistrer et continuer"}
            </button>
          </div>
        </Card>
      )}

      {step === "plan" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <Card key={plan.id} className="flex flex-col gap-3">
              <h3 className="text-xl">{plan.name}</h3>
              <p className="text-sm text-white/60">{plan.description}</p>
              <ul className="flex-1 space-y-1 text-sm text-white/70">
                {plan.features.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              <button className="btn-primary" disabled={busy} onClick={() => choosePlan(plan.id)}>
                Choisir {plan.name}
              </button>
            </Card>
          ))}
        </div>
      )}

      {step === "done" && (
        <Card className="flex flex-col items-center gap-4 py-12 text-center">
          <h2 className="text-xl">Votre espace GODAC est prêt 🎉</h2>
          <button className="btn-primary" onClick={() => router.push("/dashboard")}>
            Accéder au tableau de bord
          </button>
        </Card>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "import", label: "1. Import" },
    { id: "tanks", label: "2. Cuves" },
    { id: "plan", label: "3. Abonnement" },
  ];
  return (
    <div className="mb-6 flex gap-2">
      {steps.map((s) => (
        <span
          key={s.id}
          className={`badge ${step === s.id ? "badge-teal" : "badge-neutral"}`}
        >
          {s.label}
        </span>
      ))}
    </div>
  );
}
