"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface ConvocationRow {
  id: string;
  employeeName: string;
  reason: string;
  scheduledAt: string | null;
  location: string | null;
  status: "scheduled" | "done" | "cancelled";
  isOwn: boolean;
  /** Hiérarchie des demandes : faux si l'on ne peut pas agir sur la convocation de cette personne. */
  peutDecider?: boolean;
  mention?: string | null;
}

const STATUS_LABELS: Record<ConvocationRow["status"], string> = { scheduled: "Prévue", done: "Terminée", cancelled: "Annulée" };
const STATUS_BADGES: Record<ConvocationRow["status"], string> = { scheduled: "badge-gold", done: "badge-teal", cancelled: "badge-neutral" };

/** "Convocations" section of the Intranet page — direction/chefs d'équipe see all, an employee sees only their own (isOwn). */
export function ConvocationsList({ convocations, canManage }: { convocations: ConvocationRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setStatus(id: string, status: "done" | "cancelled") {
    setBusyId(id);
    try {
      await fetch(`/api/convocations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (convocations.length === 0) {
    return <EmptyState title="Aucune convocation" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {convocations.map((c) => (
        <Card key={c.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{canManage ? c.employeeName : "Vous êtes convoqué(e)"}</p>
              <p className="text-xs text-navy/60">
                {c.scheduledAt ? new Date(c.scheduledAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "Date non précisée"}
                {c.location && ` · ${c.location}`}
              </p>
            </div>
            <span className={STATUS_BADGES[c.status]}>{STATUS_LABELS[c.status]}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-navy/70">{c.reason}</p>
          {canManage && c.status === "scheduled" && c.peutDecider === false && (
            <p className="text-xs text-navy/60" data-testid="mention-hierarchie">
              {c.mention ?? "À gérer par un niveau supérieur"} : en lecture seule pour vous.
            </p>
          )}
          {canManage && c.peutDecider !== false && c.status === "scheduled" && (
            <div className="flex gap-2">
              <button className="btn-secondary !px-3 !py-1.5 text-xs" disabled={busyId === c.id} onClick={() => setStatus(c.id, "done")}>
                Marquer terminée
              </button>
              <button
                className="btn-secondary !px-3 !py-1.5 text-xs text-orange-ink"
                disabled={busyId === c.id}
                onClick={() => setStatus(c.id, "cancelled")}
              >
                Annuler
              </button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
