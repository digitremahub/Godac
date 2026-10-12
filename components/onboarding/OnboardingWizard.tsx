"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import {
  parseImportFile,
  vehicleCsvRowSchema,
  driverCsvRowSchema,
  type VehicleCsvRow,
  type DriverCsvRow,
} from "@/lib/utils/csv";
import { ModuleSelector } from "@/components/onboarding/ModuleSelector";
import { PlanPicker } from "@/components/onboarding/PlanPicker";
import { priceFor, type Plan, type ModuleCatalogEntry, type ModulePlanPrice, type PlanId } from "@/lib/organization/catalog-types";

type Step = "org" | "modules" | "import" | "tanks" | "subscribe" | "done";

interface Catalog {
  plans: Plan[];
  modules: ModuleCatalogEntry[];
  prices: ModulePlanPrice[];
}

interface TankDraft {
  name: string;
  fuel_type: "diesel" | "adblue";
  capacity_liters: string;
  current_totalizer_index: string;
}

export function OnboardingWizard({ stripeStatus, catalog }: { stripeStatus?: string; catalog: Catalog }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(stripeStatus === "success" ? "done" : "org");
  const [organizationName, setOrganizationName] = useState("");
  const [planId, setPlanId] = useState<PlanId>(catalog.plans[0]?.id ?? "starter");
  const [selectedModuleKeys, setSelectedModuleKeys] = useState<string[]>([]);
  const [vehicles, setVehicles] = useState<VehicleCsvRow[]>([]);
  const [drivers, setDrivers] = useState<DriverCsvRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [tanks, setTanks] = useState<TankDraft[]>([
    { name: "Cuve Gasoil", fuel_type: "diesel", capacity_liters: "", current_totalizer_index: "0" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitOrganization() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/create-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: organizationName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setStep("modules");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function submitModules() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, selectedModuleKeys }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setStep("import");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(kind: "vehicles" | "drivers", file: File) {
    if (kind === "vehicles") {
      const { rows, errors } = await parseImportFile(file, vehicleCsvRowSchema, kind);
      setVehicles(rows);
      setCsvErrors(errors.map((e) => (e.row ? `Véhicules L${e.row}: ${e.message}` : `Véhicules: ${e.message}`)));
    } else {
      const { rows, errors } = await parseImportFile(file, driverCsvRowSchema, kind);
      setDrivers(rows);
      setCsvErrors((prev) => [
        ...prev,
        ...errors.map((e) => (e.row ? `Chauffeurs L${e.row}: ${e.message}` : `Chauffeurs: ${e.message}`)),
      ]);
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
      setStep("subscribe");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function submitCheckout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
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
        description="Quatre étapes rapides avant de démarrer."
      />
      <StepIndicator step={step} />

      {error && (
        <div role="alert">
          <Card className="mb-4 border-orange/40 bg-orange/10 text-orange-ink">{error}</Card>
        </div>
      )}

      {step === "org" && (
        <Card className="flex max-w-md flex-col gap-4">
          <div>
            <label className="block"><span className="label">Nom de votre entreprise de transport</span>
            <input
              className="input"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="ex: Sud Express 66"
            /></label>
          </div>
          <button className="btn-primary" disabled={busy || !organizationName} onClick={submitOrganization}>
            {busy ? "Création…" : "Créer mon organisation"}
          </button>
        </Card>
      )}

      {step === "modules" && (
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-navy/70">Choisissez votre plan.</p>
            <PlanPicker plans={catalog.plans} selected={planId} onChange={setPlanId} />
          </div>
          <div>
            <p className="mb-2 text-navy/70">
              Ajoutez des modules complémentaires — vous pourrez les ajuster plus tard depuis
              les paramètres de votre organisation.
            </p>
            <ModuleSelector
              modules={catalog.modules}
              prices={catalog.prices}
              planId={planId}
              selected={selectedModuleKeys}
              onChange={setSelectedModuleKeys}
            />
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={busy} onClick={submitModules}>
              {busy ? "Enregistrement…" : "Continuer"}
            </button>
          </div>
        </div>
      )}

      {step === "import" && (
        <Card className="flex flex-col gap-6">
          <div>
            <p className="label">
              Véhicules — CSV ou Excel (colonnes : immatriculation, type, capacité cuve,
              kilométrage, service)
            </p>
            <input aria-label="Fichier véhicules (CSV ou Excel)"
              type="file"
              accept=".csv,.xlsx,.xls"
              className="input"
              onChange={(e) => e.target.files?.[0] && handleFile("vehicles", e.target.files[0])}
            />
            {vehicles.length > 0 && <p className="mt-1 text-sm text-teal-ink">{vehicles.length} véhicule(s) prêt(s)</p>}
          </div>
          <div>
            <p className="label">
              Chauffeurs / équipe — CSV ou Excel (colonnes : nom, email, rôle, téléphone, service)
            </p>
            <input aria-label="Fichier chauffeurs et équipe (CSV ou Excel)"
              type="file"
              accept=".csv,.xlsx,.xls"
              className="input"
              onChange={(e) => e.target.files?.[0] && handleFile("drivers", e.target.files[0])}
            />
            {drivers.length > 0 && <p className="mt-1 text-sm text-teal-ink">{drivers.length} invitation(s) prête(s)</p>}
          </div>
          {csvErrors.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-orange-ink">
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
          <p className="text-navy/70">
            Vos véhicules partagent des cuves internes — c&apos;est sur l&apos;index de
            ces cuves que GODAC détecte les écarts de ravitaillement, pas sur le
            kilométrage.
          </p>
          {tanks.map((tank, i) => (
            <div key={i} className="grid grid-cols-4 gap-3">
              <input
                className="input"
                aria-label="Nom" placeholder="Nom (ex: Cuve Gasoil A)"
                value={tank.name}
                onChange={(e) =>
                  setTanks((prev) => prev.map((t, idx) => (idx === i ? { ...t, name: e.target.value } : t)))
                }
              />
              <select aria-label="Type de carburant"
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
                aria-label="Capacité (L)" placeholder="Capacité (L)"
                value={tank.capacity_liters}
                onChange={(e) =>
                  setTanks((prev) => prev.map((t, idx) => (idx === i ? { ...t, capacity_liters: e.target.value } : t)))
                }
              />
              <input
                className="input"
                type="number"
                aria-label="Index totaliseur actuel" placeholder="Index totaliseur actuel"
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
            <button className="btn-secondary" onClick={() => setStep("subscribe")}>
              Passer cette étape
            </button>
            <button className="btn-primary" disabled={busy} onClick={submitTanks}>
              {busy ? "Enregistrement…" : "Enregistrer et continuer"}
            </button>
          </div>
        </Card>
      )}

      {step === "subscribe" && (
        <Card className="flex flex-col gap-4">
          <h2 className="text-xl">Récapitulatif de votre abonnement</h2>
          <SubscriptionSummary catalog={catalog} planId={planId} selectedModuleKeys={selectedModuleKeys} />
          <button className="btn-primary" disabled={busy} onClick={submitCheckout}>
            {busy ? "Redirection vers Stripe…" : "Passer au paiement"}
          </button>
        </Card>
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

function SubscriptionSummary({
  catalog,
  planId,
  selectedModuleKeys,
}: {
  catalog: Catalog;
  planId: PlanId;
  selectedModuleKeys: string[];
}) {
  const plan = catalog.plans.find((p) => p.id === planId);
  const selected = new Set(selectedModuleKeys);
  const addons = catalog.modules
    .filter((m) => m.wave !== "v3")
    .map((m) => ({ module: m, price: priceFor(catalog.prices, m.key, planId) }))
    .filter((x) => !x.price?.included && selected.has(x.module.key));
  const addonsTotal = addons.reduce((sum, a) => sum + Number(a.price?.monthly_price ?? 0), 0);
  const total = (plan?.monthly_base_price ?? 0) + addonsTotal;
  const setupTotal = (plan?.setup_price ?? 0) + addons.reduce((sum, a) => sum + Number(a.price?.setup_price ?? 0), 0);

  return (
    <div className="flex flex-col gap-1 text-sm text-navy/70">
      <div className="flex justify-between">
        <span>Plan {plan?.name ?? planId}</span>
        <span>{plan?.monthly_base_price ?? 0} €/mois</span>
      </div>
      {plan && plan.setup_price > 0 && (
        <div className="flex justify-between text-navy/65">
          <span>Mise en service (unique)</span>
          <span>{plan.setup_price} €</span>
        </div>
      )}
      {addons.map((a) => (
        <div key={a.module.key} className="flex flex-col">
          <div className="flex justify-between">
            <span>{a.module.name}</span>
            <span>{a.price?.monthly_price ?? 0} €/mois</span>
          </div>
          {a.price && a.price.setup_price > 0 && (
            <div className="flex justify-between text-navy/65">
              <span>Mise en service — {a.module.name} (unique)</span>
              <span>{a.price.setup_price} €</span>
            </div>
          )}
        </div>
      ))}
      <div className="mt-2 flex justify-between border-t border-navy/10 pt-2 text-lg text-navy">
        <span>Total</span>
        <span className="font-display font-extrabold text-teal-ink">{total.toFixed(2)} €/mois</span>
      </div>
      {setupTotal > 0 && (
        <div className="flex justify-between text-xs text-navy/60">
          <span>Dont mise en service, une seule fois</span>
          <span>{setupTotal.toFixed(2)} €</span>
        </div>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "org", label: "1. Organisation" },
    { id: "modules", label: "2. Modules" },
    { id: "import", label: "3. Import" },
    { id: "tanks", label: "4. Cuves" },
    { id: "subscribe", label: "5. Abonnement" },
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
