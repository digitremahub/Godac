"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface LeaveRow {
  id: string;
  driverName: string;
  serviceName: string;
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  isOwn: boolean;
  overlapWith: string[];
}

const STATUS_LABELS: Record<LeaveRow["status"], string> = {
  pending: "En attente",
  approved: "Approuvé",
  rejected: "Refusé",
};

export function LeaveRequestsList({ leaves, canDecide }: { leaves: LeaveRow[]; canDecide: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, status: "approved" | "rejected") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/leaves/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  if (leaves.length === 0) {
    return <EmptyState title="Aucune demande de congé" />;
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p className="mb-3 text-sm text-orange">{error}</p>}
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-white/40">
          <tr>
            <th className="pb-2">Chauffeur</th>
            <th className="pb-2">Service</th>
            <th className="pb-2">Période</th>
            <th className="pb-2">Motif</th>
            <th className="pb-2">Statut</th>
            {canDecide && <th className="pb-2"></th>}
          </tr>
        </thead>
        <tbody>
          {leaves.map((leave) => (
            <tr key={leave.id} className="border-t border-white/5 align-top">
              <td className="py-2">
                {leave.driverName}
                {leave.isOwn && <span className="ml-2 text-xs text-white/30">(vous)</span>}
              </td>
              <td className="py-2">{leave.serviceName}</td>
              <td className="py-2">
                {new Date(leave.startDate).toLocaleDateString("fr-FR")} → {new Date(leave.endDate).toLocaleDateString("fr-FR")}
              </td>
              <td className="py-2 text-white/60">{leave.reason ?? "—"}</td>
              <td className="py-2">
                <span
                  className={
                    leave.status === "approved" ? "badge-teal" : leave.status === "rejected" ? "badge-orange" : "badge-gold"
                  }
                >
                  {STATUS_LABELS[leave.status]}
                </span>
                {leave.overlapWith.length > 0 && (
                  <p className="mt-1 text-xs text-orange">
                    ⚠ Chevauche le congé de {leave.overlapWith.join(", ")}
                  </p>
                )}
              </td>
              {canDecide && (
                <td className="py-2">
                  {leave.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        className="btn-primary !px-2 !py-1 text-xs"
                        disabled={busyId === leave.id}
                        onClick={() => decide(leave.id, "approved")}
                      >
                        Approuver
                      </button>
                      <button
                        className="btn-danger !px-2 !py-1 text-xs"
                        disabled={busyId === leave.id}
                        onClick={() => decide(leave.id, "rejected")}
                      >
                        Refuser
                      </button>
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
