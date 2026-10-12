"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface RequestRow {
  id: string;
  vehicleRegistration: string;
  type: string;
  description: string | null;
  urgency: "low" | "normal" | "high" | "critical";
  status: "scheduled" | "in_progress" | "done" | "cancelled";
  odometerKm: number | null;
  appointmentNeeded: boolean;
  photoUrls: string[];
  requesterName: string;
  createdAt: string;
}

const URGENCY_LABELS: Record<RequestRow["urgency"], string> = {
  low: "Faible",
  normal: "Normale",
  high: "Haute",
  critical: "Critique",
};

const URGENCY_BADGES: Record<RequestRow["urgency"], string> = {
  low: "badge-neutral",
  normal: "badge-teal",
  high: "badge-gold",
  critical: "badge-orange",
};

const STATUS_LABELS: Record<RequestRow["status"], string> = {
  scheduled: "Planifiée",
  in_progress: "En cours",
  done: "Terminée",
  cancelled: "Annulée",
};

const STATUS_FLOW: Record<RequestRow["status"], RequestRow["status"] | null> = {
  scheduled: "in_progress",
  in_progress: "done",
  done: null,
  cancelled: null,
};

export function MaintenanceRequestsList({ requests, canManage }: { requests: RequestRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editUrgency, setEditUrgency] = useState<RequestRow["urgency"]>("normal");
  const [error, setError] = useState<string | null>(null);

  function startEdit(r: RequestRow) {
    setEditingId(r.id);
    setEditType(r.type);
    setEditDescription(r.description ?? "");
    setEditUrgency(r.urgency);
    setError(null);
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/vehicle-interventions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: editType, description: editDescription || null, urgency: editUrgency }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  async function advance(r: RequestRow) {
    const next = STATUS_FLOW[r.status];
    if (!next) return;
    setBusyId(r.id);
    try {
      await fetch(`/api/vehicle-interventions/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, ...(next === "done" ? { completed_at: new Date().toISOString() } : {}) }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return <EmptyState title="Aucune demande d'entretien" />;
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p role="alert" className="mb-3 text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[1000px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Véhicule</th>
            <th className="pb-2">Type</th>
            <th className="pb-2">Description</th>
            <th className="pb-2">Km</th>
            <th className="pb-2">Photos</th>
            <th className="pb-2">Urgence</th>
            <th className="pb-2">Demandeur</th>
            <th className="pb-2">Statut</th>
            {canManage && <th className="pb-2"></th>}
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const isEditing = editingId === r.id;
            return (
              <tr key={r.id} className="border-t border-navy/5 align-top">
                <td className="py-2">{r.vehicleRegistration}</td>
                <td className="py-2">{isEditing ? <input aria-label="Type de problème" className="input !py-1" value={editType} onChange={(e) => setEditType(e.target.value)} /> : r.type}</td>
                <td className="py-2 text-navy/70">
                  {isEditing ? (
                    <input aria-label="Description" className="input !py-1" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                  ) : (
                    r.description ?? "—"
                  )}
                  {r.appointmentNeeded && <span className="badge-gold ml-2">RDV garage à prévoir</span>}
                </td>
                <td className="py-2 text-navy/70">{r.odometerKm ?? "—"}</td>
                <td className="py-2">
                  {r.photoUrls.length > 0 ? (
                    <div className="flex gap-1">
                      {r.photoUrls.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img width={40} height={40} loading="lazy" src={url} alt="Photo du signalement" className="h-10 w-10 rounded object-cover" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2">
                  {isEditing ? (
                    <select aria-label="Urgence"
                      className="input !w-auto !py-1"
                      value={editUrgency}
                      onChange={(e) => setEditUrgency(e.target.value as RequestRow["urgency"])}
                    >
                      {Object.entries(URGENCY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={URGENCY_BADGES[r.urgency]}>{URGENCY_LABELS[r.urgency]}</span>
                  )}
                </td>
                <td className="py-2">{r.requesterName}</td>
                <td className="py-2">
                  <span className="badge-neutral">{STATUS_LABELS[r.status]}</span>
                </td>
                {canManage && (
                  <td className="py-2">
                    <div className="flex gap-2">
                      {isEditing ? (
                        <>
                          <button className="btn-primary !px-2 !py-1 text-xs" disabled={busyId === r.id} onClick={() => saveEdit(r.id)}>
                            Enregistrer
                          </button>
                          <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busyId === r.id} onClick={() => setEditingId(null)}>
                            Annuler
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busyId === r.id} onClick={() => startEdit(r)}>
                            Modifier
                          </button>
                          {STATUS_FLOW[r.status] && (
                            <button className="btn-primary !px-2 !py-1 text-xs" disabled={busyId === r.id} onClick={() => advance(r)}>
                              → {STATUS_LABELS[STATUS_FLOW[r.status]!]}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
