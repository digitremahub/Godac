"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import type { AiVehicleSpecs } from "@/lib/vehicles/ai-specs";
import { IconSparkles } from "@/components/layout/icons";

interface ServiceOption {
  id: string;
  name: string;
}

interface DriverOption {
  id: string;
  full_name: string;
}

const STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  maintenance: "Entretien",
  out_of_service: "Hors service",
};

const CONFIDENCE_LABELS: Record<string, string> = { élevé: "confiance élevée", moyen: "confiance moyenne", faible: "confiance faible" };

type SpecSources = Record<string, { origin: "ia" | "saisie" | "import"; confirmed: boolean } | undefined>;

export function EditVehicleForm({
  vehicleId,
  registration: initialRegistration,
  type: initialType,
  tankCapacity: initialTankCapacity,
  initialKm: initialInitialKm,
  status: initialStatus,
  serviceId: initialServiceId,
  services,
  assignedDriverId: initialAssignedDriverId,
  drivers,
  brand: initialBrand,
  model: initialModel,
  modelYear: initialModelYear,
  gearbox: initialGearbox,
  fuelType: initialFuelType,
  adblueCapacity: initialAdblueCapacity,
  ptac: initialPtac,
  referenceConsumption: initialReferenceConsumption,
  specSources: initialSpecSources,
  onClose,
}: {
  vehicleId: string;
  registration: string;
  type: "VL" | "PL" | "SPL";
  tankCapacity: number | null;
  initialKm: number | null;
  status: "active" | "maintenance" | "out_of_service";
  serviceId: string | null;
  services: ServiceOption[];
  assignedDriverId: string | null;
  drivers: DriverOption[];
  brand: string | null;
  model: string | null;
  modelYear: number | null;
  gearbox: string | null;
  fuelType: string | null;
  adblueCapacity: number | null;
  ptac: number | null;
  referenceConsumption: number | null;
  specSources: SpecSources;
  onClose: () => void;
}) {
  const router = useRouter();
  const [registration, setRegistration] = useState(initialRegistration);
  const [type, setType] = useState(initialType);
  const [tankCapacity, setTankCapacity] = useState(initialTankCapacity?.toString() ?? "");
  const [initialKm, setInitialKm] = useState(initialInitialKm?.toString() ?? "");
  const [status, setStatus] = useState(initialStatus);
  const [serviceId, setServiceId] = useState(initialServiceId ?? "");
  const [assignedDriverId, setAssignedDriverId] = useState(initialAssignedDriverId ?? "");
  const [brand, setBrand] = useState(initialBrand ?? "");
  const [model, setModel] = useState(initialModel ?? "");
  const [year, setYear] = useState(initialModelYear?.toString() ?? "");
  const [gearbox, setGearbox] = useState(initialGearbox ?? "");
  const [fuelType, setFuelType] = useState(initialFuelType ?? "");
  const [adblueCapacity, setAdblueCapacity] = useState(initialAdblueCapacity?.toString() ?? "");
  const [ptac, setPtac] = useState(initialPtac?.toString() ?? "");
  const [referenceConsumption, setReferenceConsumption] = useState(initialReferenceConsumption?.toString() ?? "");
  const [specSources, setSpecSources] = useState<SpecSources>(initialSpecSources ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [variants, setVariants] = useState<AiVehicleSpecs["variants"]>([]);

  function markAi(field: string) {
    setSpecSources((prev) => ({ ...prev, [field]: { origin: "ia", confirmed: false } }));
  }
  function clearAi(field: string) {
    setSpecSources((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }
  function confirmAi(field: string) {
    setSpecSources((prev) => (prev[field] ? { ...prev, [field]: { ...prev[field]!, confirmed: true } } : prev));
  }

  async function completeByAi() {
    setAiBusy(true);
    setAiError(null);
    setVariants([]);
    try {
      const res = await fetch("/api/vehicles/ai-specs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, model, year: year || undefined, gearbox: gearbox || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      const specs = json.specs as AiVehicleSpecs;

      if (specs.type.value) {
        setType(specs.type.value);
        markAi("type");
      }
      if (specs.fuel_type.value && !fuelType) {
        setFuelType(specs.fuel_type.value);
        markAi("fuel_type");
      }
      if (specs.tank_capacity_liters.value && !tankCapacity) {
        setTankCapacity(String(specs.tank_capacity_liters.value));
        markAi("tank_capacity_liters");
      }
      if (specs.adblue_capacity_liters.value && !adblueCapacity) {
        setAdblueCapacity(String(specs.adblue_capacity_liters.value));
        markAi("adblue_capacity_liters");
      }
      if (specs.ptac_kg.value && !ptac) {
        setPtac(String(specs.ptac_kg.value));
        markAi("ptac_kg");
      }
      if (specs.reference_consumption_l_100km.value && !referenceConsumption) {
        setReferenceConsumption(String(specs.reference_consumption_l_100km.value));
        markAi("reference_consumption_l_100km");
      }
      if (specs.variants.length > 0) setVariants(specs.variants);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setAiBusy(false);
    }
  }

  function applyVariant(v: AiVehicleSpecs["variants"][number]) {
    if (v.tank_capacity_liters) {
      setTankCapacity(String(v.tank_capacity_liters));
      markAi("tank_capacity_liters");
    }
    if (v.ptac_kg) {
      setPtac(String(v.ptac_kg));
      markAi("ptac_kg");
    }
    setVariants([]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const cleanedSpecSources = Object.fromEntries(Object.entries(specSources).filter(([, v]) => v));
      const res = await fetch(`/api/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration,
          type,
          tank_capacity_liters: tankCapacity ? Number(tankCapacity) : null,
          initial_km: initialKm ? Number(initialKm) : null,
          status,
          service_id: serviceId || null,
          assigned_driver_id: assignedDriverId || null,
          brand: brand || null,
          model: model || null,
          model_year: year ? Number(year) : null,
          gearbox: gearbox || null,
          fuel_type: fuelType || null,
          adblue_capacity_liters: adblueCapacity ? Number(adblueCapacity) : null,
          ptac_kg: ptac ? Number(ptac) : null,
          reference_consumption_l_100km: referenceConsumption ? Number(referenceConsumption) : null,
          spec_sources: cleanedSpecSources,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  function AiBadge({ field }: { field: string }) {
    const state = specSources[field];
    if (!state || state.origin !== "ia") return null;
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-gold-ink">
        <IconSparkles className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Estimé par IA
        {!state.confirmed && (
          <button type="button" className="underline" onClick={() => confirmAi(field)}>
            confirmer
          </button>
        )}
      </span>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <h3 className="text-lg">Modifier le véhicule</h3>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      <div>
        <label className="block"><span className="label">Immatriculation</span>
        <input className="input" value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase())} /></label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block"><span className="label">Marque</span>
          <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
        </div>
        <div>
          <label className="block"><span className="label">Modèle</span>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} /></label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block"><span className="label">Année</span>
          <input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} /></label>
        </div>
        <div>
          <label className="block"><span className="label">Boîte de vitesses</span>
          <select className="input" value={gearbox} onChange={(e) => setGearbox(e.target.value)}>
            <option value="">Non précisé</option>
            <option value="manuelle">Manuelle</option>
            <option value="automatique">Automatique</option>
          </select></label>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <button type="button" className="btn-secondary self-start" disabled={aiBusy || !brand || !model} onClick={completeByAi}>
          {aiBusy ? "Estimation en cours…" : <><IconSparkles className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Compléter les champs vides par IA</>}
        </button>
        {aiError && <p role="alert" className="text-xs text-orange-ink">{aiError}</p>}
        {variants.length > 0 && (
          <div className="mt-1 flex flex-col gap-1 rounded-lg bg-gold/10 p-3 text-sm">
            <p className="text-gold-ink">Plusieurs versions possibles — choisissez la vôtre :</p>
            {variants.map((v, i) => (
              <button
                key={i}
                type="button"
                className="rounded-lg bg-white px-3 py-2 text-left text-xs hover:bg-navy/[0.04]"
                onClick={() => applyVariant(v)}
              >
                {v.label}
                {v.tank_capacity_liters ? ` — réservoir ${v.tank_capacity_liters} L` : ""}
                {v.ptac_kg ? ` — PTAC ${v.ptac_kg} kg` : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block"><span className="label">Type</span>
        <select
          className="input"
          value={type}
          onChange={(e) => {
            setType(e.target.value as "VL" | "PL" | "SPL");
            clearAi("type");
          }}
        >
          <option value="VL">VL (véhicule léger)</option>
          <option value="PL">PL (poids lourd)</option>
          <option value="SPL">SPL (semi-remorque)</option>
        </select></label>
        <AiBadge field="type" />
      </div>

      <div>
        <label className="block"><span className="label">Carburant</span>
        <input
          className="input"
          value={fuelType}
          onChange={(e) => {
            setFuelType(e.target.value);
            clearAi("fuel_type");
          }}
        /></label>
        <AiBadge field="fuel_type" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block"><span className="label">Capacité réservoir (L)</span>
          <input
            className="input"
            type="number"
            value={tankCapacity}
            onChange={(e) => {
              setTankCapacity(e.target.value);
              clearAi("tank_capacity_liters");
            }}
          /></label>
          <AiBadge field="tank_capacity_liters" />
        </div>
        <div>
          <label className="block"><span className="label">Capacité AdBlue (L)</span>
          <input
            className="input"
            type="number"
            value={adblueCapacity}
            onChange={(e) => {
              setAdblueCapacity(e.target.value);
              clearAi("adblue_capacity_liters");
            }}
          /></label>
          <AiBadge field="adblue_capacity_liters" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block"><span className="label">PTAC (kg)</span>
          <input
            className="input"
            type="number"
            value={ptac}
            onChange={(e) => {
              setPtac(e.target.value);
              clearAi("ptac_kg");
            }}
          /></label>
          <AiBadge field="ptac_kg" />
        </div>
        <div>
          <label className="block"><span className="label">Consommation de référence (L/100km)</span>
          <input
            className="input"
            type="number"
            step="0.1"
            value={referenceConsumption}
            onChange={(e) => {
              setReferenceConsumption(e.target.value);
              clearAi("reference_consumption_l_100km");
            }}
          /></label>
          <AiBadge field="reference_consumption_l_100km" />
        </div>
      </div>

      <div>
        <label className="block"><span className="label">Kilométrage initial</span>
        <input className="input" type="number" value={initialKm} onChange={(e) => setInitialKm(e.target.value)} /></label>
      </div>
      <div>
        <label className="block"><span className="label">Statut</span>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select></label>
      </div>
      <div>
        <label className="block"><span className="label">Service</span>
        <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Aucun</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select></label>
      </div>
      <div>
        <label className="block"><span className="label">Chauffeur assigné</span>
        <select className="input" value={assignedDriverId} onChange={(e) => setAssignedDriverId(e.target.value)}>
          <option value="">Aucun</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name}
            </option>
          ))}
        </select></label>
        <p className="mt-1 text-xs text-navy/60">
          C&apos;est ce véhicule que le chauffeur retrouve dans &quot;Mon véhicule&quot;. Il peut aussi prendre
          lui-même un véhicule non assigné.
        </p>
      </div>

      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !registration} onClick={save}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Annuler
        </button>
      </div>
    </Card>
  );
}
