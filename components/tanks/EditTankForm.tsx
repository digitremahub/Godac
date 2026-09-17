"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface ServiceOption {
  id: string;
  name: string;
}

export function EditTankForm({
  tankId,
  name: initialName,
  fuelType: initialFuelType,
  capacityLiters: initialCapacity,
  serviceId: initialServiceId,
  services,
  onClose,
}: {
  tankId: string;
  name: string;
  fuelType: "diesel" | "adblue";
  capacityLiters: number;
  serviceId: string | null;
  services: ServiceOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [fuelType, setFuelType] = useState(initialFuelType);
  const [capacity, setCapacity] = useState(initialCapacity.toString());
  const [serviceId, setServiceId] = useState(initialServiceId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tanks/${tankId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          fuel_type: fuelType,
          capacity_liters: Number(capacity),
          service_id: serviceId || null,
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

  return (
    <Card className="flex flex-col gap-3">
      {error && <p className="text-sm text-orange">{error}</p>}
      <div>
        <label className="label">Nom</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" value={fuelType} onChange={(e) => setFuelType(e.target.value as "diesel" | "adblue")}>
          <option value="diesel">Diesel</option>
          <option value="adblue">AdBlue</option>
        </select>
      </div>
      <div>
        <label className="label">Capacité (L)</label>
        <input className="input" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
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
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !name || !capacity} onClick={save}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={onClose}>
          Annuler
        </button>
      </div>
    </Card>
  );
}
