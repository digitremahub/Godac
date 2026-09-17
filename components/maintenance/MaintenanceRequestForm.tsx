"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface VehicleOption {
  id: string;
  registration: string;
}

const URGENCY_LABELS: Record<string, string> = {
  low: "Faible",
  normal: "Normale",
  high: "Haute",
  critical: "Critique",
};

export function MaintenanceRequestForm({ vehicles }: { vehicles: VehicleOption[] }) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "");
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch("/api/vehicle-interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: vehicleId, type, description: description || undefined, urgency }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setType("");
      setDescription("");
      setUrgency("normal");
      setSent(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (vehicles.length === 0) {
    return <Card className="text-sm text-navy/50">Aucun véhicule disponible pour ouvrir une demande.</Card>;
  }

  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg">Nouvelle demande d&apos;entretien</h3>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {sent && <p className="text-sm text-teal-ink">Demande envoyée.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
        <div>
          <label className="label">Véhicule</label>
          <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Type</label>
          <input className="input" placeholder="ex: Freins, Pneus..." value={type} onChange={(e) => setType(e.target.value)} />
        </div>
        <div>
          <label className="label">Urgence</label>
          <select className="input" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
            {Object.entries(URGENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Description (optionnel)</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <button className="btn-primary self-start" disabled={busy || !vehicleId || !type} onClick={submit}>
        {busy ? "Envoi…" : "Envoyer la demande"}
      </button>
    </Card>
  );
}
