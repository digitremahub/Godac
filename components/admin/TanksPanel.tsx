"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface TankRow {
  id: string;
  name: string;
  fuel_type: "diesel" | "adblue";
  capacity_liters: number;
  current_totalizer_index: number;
  service_id: string | null;
}

interface ServiceOption {
  id: string;
  name: string;
}

export function TanksPanel({ tanks, services }: { tanks: TankRow[]; services: ServiceOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [fuelType, setFuelType] = useState<"diesel" | "adblue">("diesel");
  const [capacity, setCapacity] = useState("");
  const [startIndex, setStartIndex] = useState("0");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addTank() {
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
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function updateTank(id: string, patch: Partial<{ name: string; service_id: string | null }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tanks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTank(id: string) {
    if (!confirm("Supprimer cette cuve ?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tanks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h3 className="text-lg">Cuves</h3>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
        <div className="col-span-2 sm:col-span-1">
          <label className="block"><span className="label">Nom</span>
          <input className="input" placeholder="Cuve Gasoil B" value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
        <div>
          <label className="block"><span className="label">Type</span>
          <select className="input" value={fuelType} onChange={(e) => setFuelType(e.target.value as "diesel" | "adblue")}>
            <option value="diesel">Diesel</option>
            <option value="adblue">AdBlue</option>
          </select></label>
        </div>
        <div>
          <label className="block"><span className="label">Capacité (L)</span>
          <input className="input" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
        </div>
        <div>
          <label className="block"><span className="label">Index initial</span>
          <input className="input" type="number" value={startIndex} onChange={(e) => setStartIndex(e.target.value)} /></label>
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
      </div>
      <button className="btn-primary self-start" disabled={busy || !name || !capacity} onClick={addTank}>
        Ajouter la cuve
      </button>

      {tanks.length === 0 ? (
        <p className="text-sm text-navy/60">Aucune cuve configurée.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tanks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
              <input aria-label="Nom de la cuve"
                className="input flex-1 !py-1"
                defaultValue={t.name}
                onBlur={(e) => e.target.value !== t.name && updateTank(t.id, { name: e.target.value })}
                disabled={busy}
              />
              <span className={t.fuel_type === "diesel" ? "badge-teal" : "badge-gold"}>
                {t.fuel_type === "diesel" ? "Diesel" : "AdBlue"}
              </span>
              <span className="text-sm text-navy/60">{t.capacity_liters.toLocaleString("fr-FR")} L</span>
              <select aria-label="Service de la cuve"
                className="input !w-auto !py-1"
                defaultValue={t.service_id ?? ""}
                onChange={(e) => updateTank(t.id, { service_id: e.target.value || null })}
                disabled={busy}
              >
                <option value="">Sans service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button className="btn-danger ml-auto !px-2 !py-1 text-xs" disabled={busy} onClick={() => deleteTank(t.id)}>
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
