"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
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
    <Card className="flex flex-col gap-4">
      <h3 className="text-lg">Modifier le véhicule</h3>
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
        <label className="label">Kilométrage initial</label>
        <input className="input" type="number" value={initialKm} onChange={(e) => setInitialKm(e.target.value)} />
      </div>
      <div>
        <label className="label">Statut</label>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
      <div>
        <label className="label">Chauffeur assigné</label>
        <select className="input" value={assignedDriverId} onChange={(e) => setAssignedDriverId(e.target.value)}>
          <option value="">Aucun</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-navy/40">
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
