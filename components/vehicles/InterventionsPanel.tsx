"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface Intervention {
  id: string;
  type: string;
  description: string | null;
  urgency: "low" | "normal" | "high" | "critical";
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

const URGENCY_LABELS: Record<Intervention["urgency"], string> = {
  low: "Faible",
  normal: "Normale",
  high: "Haute",
  critical: "Critique",
};

const URGENCY_BADGES: Record<Intervention["urgency"], string> = {
  low: "badge-neutral",
  normal: "badge-teal",
  high: "badge-gold",
  critical: "badge-orange",
};

export function InterventionsPanel({
  vehicleId,
  interventions,
  canManage,
}: {
  vehicleId: string;
  interventions: Intervention[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState<Intervention["urgency"]>("normal");
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editUrgency, setEditUrgency] = useState<Intervention["urgency"]>("normal");

  async function addIntervention() {
    if (!type) return;
    setBusy(true);
    try {
      await fetch("/api/vehicle-interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: vehicleId, type, description: description || undefined, urgency }),
      });
      setType("");
      setDescription("");
      setUrgency("normal");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function startEdit(i: Intervention) {
    setEditingId(i.id);
    setEditType(i.type);
    setEditDescription(i.description ?? "");
    setEditUrgency(i.urgency);
  }

  async function saveEdit(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/vehicle-interventions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: editType, description: editDescription || null, urgency: editUrgency }),
      });
      setEditingId(null);
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

      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input" placeholder="Type (ex: Vidange)" value={type} onChange={(e) => setType(e.target.value)} />
        <input
          className="input"
          placeholder="Description (optionnel)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <select className="input !w-auto" value={urgency} onChange={(e) => setUrgency(e.target.value as Intervention["urgency"])}>
          {Object.entries(URGENCY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button className="btn-secondary shrink-0" disabled={busy || !type} onClick={addIntervention}>
          + Ajouter
        </button>
      </div>

      {interventions.length === 0 ? (
        <p className="text-sm text-white/40">Aucune intervention enregistrée.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {interventions.map((i) => {
            const isEditing = editingId === i.id;
            return (
              <li key={i.id} className="rounded-lg bg-white/5 px-3 py-2 text-sm">
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <input className="input !py-1" value={editType} onChange={(e) => setEditType(e.target.value)} />
                    <input className="input !py-1" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                    <select
                      className="input !w-auto !py-1"
                      value={editUrgency}
                      onChange={(e) => setEditUrgency(e.target.value as Intervention["urgency"])}
                    >
                      {Object.entries(URGENCY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button className="btn-primary !px-2 !py-1 text-xs" disabled={busy} onClick={() => saveEdit(i.id)}>
                        Enregistrer
                      </button>
                      <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => setEditingId(null)}>
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{i.type}</p>
                      {i.description && <p className="text-white/50">{i.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={URGENCY_BADGES[i.urgency]}>{URGENCY_LABELS[i.urgency]}</span>
                      <span className="badge-neutral">{STATUS_LABELS[i.status]}</span>
                      {canManage && (
                        <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => startEdit(i)}>
                          Modifier
                        </button>
                      )}
                      {canManage && STATUS_FLOW[i.status] && (
                        <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busy} onClick={() => advance(i)}>
                          → {STATUS_LABELS[STATUS_FLOW[i.status]!]}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
