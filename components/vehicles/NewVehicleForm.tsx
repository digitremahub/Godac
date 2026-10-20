"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import type { AiVehicleSpecs } from "@/lib/vehicles/ai-specs";
import { IconSparkles } from "@/components/layout/icons";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import { BandeauRefus } from "@/components/acces/BandeauRefus";

interface ServiceOption {
  id: string;
  name: string;
}

const CONFIDENCE_LABELS: Record<string, string> = { élevé: "confiance élevée", moyen: "confiance moyenne", faible: "confiance faible" };

/** Per-field AI provenance tracked client-side until submit, mirrors `vehicles.spec_sources`. */
type AiFieldState = Partial<Record<string, { confidence: string | null; confirmed: boolean }>>;

export function NewVehicleForm({ services, direction = false }: { services: ServiceOption[]; direction?: boolean }) {
  const [refus, setRefus] = useState<Refus | null>(null);
  const router = useRouter();
  const [registration, setRegistration] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [gearbox, setGearbox] = useState("");
  const [type, setType] = useState<"VL" | "PL" | "SPL">("PL");
  const [fuelType, setFuelType] = useState("");
  const [tankCapacity, setTankCapacity] = useState("");
  const [adblueCapacity, setAdblueCapacity] = useState("");
  const [ptac, setPtac] = useState("");
  const [referenceConsumption, setReferenceConsumption] = useState("");
  const [initialKm, setInitialKm] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiFields, setAiFields] = useState<AiFieldState>({});
  const [variants, setVariants] = useState<AiVehicleSpecs["variants"]>([]);

  function markAi(field: string, confidence: string | null) {
    setAiFields((prev) => ({ ...prev, [field]: { confidence, confirmed: false } }));
  }
  function clearAi(field: string) {
    setAiFields((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }
  function confirmAi(field: string) {
    setAiFields((prev) => (prev[field] ? { ...prev, [field]: { ...prev[field]!, confirmed: true } } : prev));
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
        markAi("type", specs.type.confidence);
      }
      if (specs.fuel_type.value && !fuelType) {
        setFuelType(specs.fuel_type.value);
        markAi("fuel_type", specs.fuel_type.confidence);
      }
      if (specs.tank_capacity_liters.value && !tankCapacity) {
        setTankCapacity(String(specs.tank_capacity_liters.value));
        markAi("tank_capacity_liters", specs.tank_capacity_liters.confidence);
      }
      if (specs.adblue_capacity_liters.value && !adblueCapacity) {
        setAdblueCapacity(String(specs.adblue_capacity_liters.value));
        markAi("adblue_capacity_liters", specs.adblue_capacity_liters.confidence);
      }
      if (specs.ptac_kg.value && !ptac) {
        setPtac(String(specs.ptac_kg.value));
        markAi("ptac_kg", specs.ptac_kg.confidence);
      }
      if (specs.reference_consumption_l_100km.value && !referenceConsumption) {
        setReferenceConsumption(String(specs.reference_consumption_l_100km.value));
        markAi("reference_consumption_l_100km", specs.reference_consumption_l_100km.confidence);
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
      markAi("tank_capacity_liters", "élevé");
    }
    if (v.ptac_kg) {
      setPtac(String(v.ptac_kg));
      markAi("ptac_kg", "élevé");
    }
    setVariants([]);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setRefus(null);
    try {
      const specSources: Record<string, { origin: "ia"; confirmed: boolean }> = {};
      for (const [field, state] of Object.entries(aiFields)) {
        if (state) specSources[field] = { origin: "ia", confirmed: state.confirmed };
      }
      const res = await fetchGodac<{ vehicle: { id: string } }>("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration,
          brand: brand || undefined,
          model: model || undefined,
          model_year: year ? Number(year) : undefined,
          gearbox: gearbox || undefined,
          type,
          fuel_type: fuelType || undefined,
          tank_capacity_liters: tankCapacity ? Number(tankCapacity) : undefined,
          adblue_capacity_liters: adblueCapacity ? Number(adblueCapacity) : undefined,
          ptac_kg: ptac ? Number(ptac) : undefined,
          reference_consumption_l_100km: referenceConsumption ? Number(referenceConsumption) : undefined,
          initial_km: Number(initialKm),
          service_id: serviceId || undefined,
          spec_sources: Object.keys(specSources).length > 0 ? specSources : undefined,
        }),
      });
      // Refus homogène (limite de formule, rôle, module) : bandeau avec l'action adaptée.
      if (!res.ok) {
        setRefus(res.refus);
        return;
      }
      router.push(`/flotte/vehicules/${res.data.vehicle.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  function AiBadge({ field }: { field: string }) {
    const state = aiFields[field];
    if (!state) return null;
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 text-xs text-gold-ink">
        <IconSparkles className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Estimé par IA{state.confidence ? ` · ${CONFIDENCE_LABELS[state.confidence] ?? state.confidence}` : ""}
        {!state.confirmed && (
          <button type="button" className="underline" onClick={() => confirmAi(field)}>
            confirmer
          </button>
        )}
      </span>
    );
  }

  return (
    <Card className="flex max-w-lg flex-col gap-4">
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      <BandeauRefus refus={refus} direction={direction} onFermer={() => setRefus(null)} />

      <div>
        <label className="block"><span className="label">Immatriculation</span>
        <input className="input" value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase())} /></label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block"><span className="label">Marque</span>
          <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="ex: Renault Trucks" /></label>
        </div>
        <div>
          <label className="block"><span className="label">Modèle</span>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="ex: D Wide" /></label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block"><span className="label">Année (optionnel)</span>
          <input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} /></label>
        </div>
        <div>
          <label className="block"><span className="label">Boîte de vitesses (optionnel)</span>
          <select className="input" value={gearbox} onChange={(e) => setGearbox(e.target.value)}>
            <option value="">Non précisé</option>
            <option value="manuelle">Manuelle</option>
            <option value="automatique">Automatique</option>
          </select></label>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <button type="button" className="btn-secondary self-start" disabled={aiBusy || !brand || !model} onClick={completeByAi}>
          {aiBusy ? "Estimation en cours…" : <><IconSparkles className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Compléter par IA</>}
        </button>
        {aiError && <p role="alert" className="text-xs text-orange-ink">{aiError}</p>}
        {variants.length > 0 && (
          <div className="mt-1 flex flex-col gap-1 rounded-lg bg-gold/10 p-3 text-sm">
            <p className="text-gold-ink">Plusieurs versions possibles — choisissez la vôtre :</p>
            {variants.map((v, i) => (
              <button
                key={i}
                type="button"
                className="rounded-lg bg-surface px-3 py-2 text-left text-xs hover:bg-navy/[0.04]"
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
        <label className="block"><span className="label">Carburant (optionnel)</span>
        <input
          className="input"
          value={fuelType}
          onChange={(e) => {
            setFuelType(e.target.value);
            clearAi("fuel_type");
          }}
          placeholder="ex: diesel"
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
        <label className="block"><span className="label">Kilométrage actuel *</span>
        <input className="input" type="number" value={initialKm} onChange={(e) => setInitialKm(e.target.value)} /></label>
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

      <button className="btn-primary" disabled={busy || !registration || !initialKm} onClick={submit}>
        {busy ? "Création…" : "Créer le véhicule"}
      </button>
    </Card>
  );
}
