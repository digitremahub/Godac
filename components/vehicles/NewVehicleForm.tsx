"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface ServiceOption {
  id: string;
  name: string;
}

export function NewVehicleForm({ services }: { services: ServiceOption[] }) {
  const router = useRouter();
  const [registration, setRegistration] = useState("");
  const [type, setType] = useState<"VL" | "PL" | "SPL">("PL");
  const [tankCapacity, setTankCapacity] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registration,
          type,
          tank_capacity_liters: tankCapacity ? Number(tankCapacity) : undefined,
          service_id: serviceId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      router.push(`/vehicles/${json.vehicle.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-lg flex-col gap-4">
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      <div>
        <label className="label">Immatriculation</label>
        <input className="input" value={registration} onChange={(e) => setRegistration(e.target.value.toUpperCase())} />
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as "VL" | "PL" | "SPL")}>
          <option value="VL">VL (véhicule léger)</option>
          <option value="PL">PL (poids lourd)</option>
          <option value="SPL">SPL (semi-remorque)</option>
        </select>
      </div>
      <div>
        <label className="label">Capacité réservoir (L)</label>
        <input className="input" type="number" value={tankCapacity} onChange={(e) => setTankCapacity(e.target.value)} />
      </div>
      <div>
        <label className="label">Service</label>
        <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Aucun</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <button className="btn-primary" disabled={busy || !registration} onClick={submit}>
        {busy ? "Création…" : "Créer le véhicule"}
      </button>
    </Card>
  );
}
