"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface ServiceOption {
  id: string;
  name: string;
}

export function AddTankForm({ services }: { services: ServiceOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fuelType, setFuelType] = useState<"diesel" | "adblue">("diesel");
  const [capacity, setCapacity] = useState("");
  const [startIndex, setStartIndex] = useState("0");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tanks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          fuel_type: fuelType,
          capacity_liters: Number(capacity),
          current_totalizer_index: Number(startIndex || 0),
          service_id: serviceId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setName("");
      setCapacity("");
      setStartIndex("0");
      setServiceId("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-primary mb-6" onClick={() => setOpen(true)}>
        + Ajouter une cuve
      </button>
    );
  }

  return (
    <Card className="mb-6 flex flex-col gap-3">
      <h3 className="text-lg">Nouvelle cuve</h3>
      {error && <p className="text-sm text-orange">{error}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
        <div className="col-span-2 sm:col-span-1">
          <label className="label">Nom</label>
          <input className="input" placeholder="Cuve Gasoil A" value={name} onChange={(e) => setName(e.target.value)} />
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
          <label className="label">Index initial</label>
          <input className="input" type="number" value={startIndex} onChange={(e) => setStartIndex(e.target.value)} />
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
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !name || !capacity} onClick={submit}>
          {busy ? "Enregistrement…" : "Ajouter"}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </Card>
  );
}
