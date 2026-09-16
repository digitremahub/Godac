"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface Intervention {
  id: string;
  type: string;
  description: string | null;
  status: "scheduled" | "in_progress" | "done" | "cancelled";
  scheduled_at: string | null;
  completed_at: string | null;
  cost: number | null;
}

const STATUS_FLOW: Record<Intervention["status"], Intervention["status"] | null> = {
  scheduled: "in_progress",
  in_progress: "done",
  done: null,
  cancelled: null,
};

const STATUS_LABELS: Record<Intervention["status"], string> = {
  scheduled: "Planifiée",
  in_progress: "En cours",
  done: "Terminée",
  cancelled: "Annulée",
};

export function InterventionsPanel({ vehicleId, interventions }: { vehicleId: string; interventions: Intervention[] }) {
  const router = useRouter();
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function addIntervention() {
    if (!type) return;
    setBusy(true);
    try {
      await fetch("/api/vehicle-interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: vehicleId, type, description: description || undefined }),
      });
      setType("");
      setDescription("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function advance(intervention: Intervention) {
    const next = STATUS_FLOW[intervention.status];
    if (!next) return;
    setBusy(true);
    try {
      await fetch(`/api/vehicle-interventions/${intervention.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: next,
          ...(next === "done" ? { completed_at: new Date().toISOString() } : {}),
        }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="mb-3 text-lg">Interventions / entretiens</h3>

      <div className="mb-4 flex gap-2">
        <input className="input" placeholder="Type (ex: Vidange)" value={type} onChange={(e) => setType(e.target.value)} />
        <input
          className="input"
          placeholder="Description (optionnel)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button className="btn-secondary shrink-0" disabled={busy || !type} onClick={addIntervention}>
          + Ajouter
        </button>
      </div>

      {interventions.length === 0 ? (
        <p className="text-sm text-white/40">Aucune intervention enregistrée.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {interventions.map((i) => (
            <li key={i.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{i.type}</p>
                {i.description && <p className="text-white/50">{i.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                <span className="badge-neutral">{STATUS_LABELS[i.status]}</span>
                {STATUS_FLOW[i.status] && (
                  <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => advance(i)}>
                    → {STATUS_LABELS[STATUS_FLOW[i.status]!]}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
