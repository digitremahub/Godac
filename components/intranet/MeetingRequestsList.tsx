"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface MeetingRequestRow {
  id: string;
  requesterName: string;
  reason: string;
  preferredDate: string | null;
  status: "pending" | "scheduled" | "declined" | "done";
  createdAt: string;
  isOwn: boolean;
  /** Hiérarchie des demandes : faux si la demande est celle de la personne connectée, ou d'un rang égal ou supérieur. */
  peutDecider?: boolean;
  mention?: string | null;
  /** « En attente de … » : niveau qui doit traiter la demande. */
  libelleAttente?: string;
}

const STATUS_LABELS: Record<MeetingRequestRow["status"], string> = {
  pending: "En attente",
  scheduled: "Planifié",
  declined: "Refusé",
  done: "Terminé",
};

const STATUS_BADGES: Record<MeetingRequestRow["status"], string> = {
  pending: "badge-gold",
  scheduled: "badge-teal",
  declined: "badge-neutral",
  done: "badge-neutral",
};

export function MeetingRequestsList({ requests, canManage }: { requests: MeetingRequestRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(id: string, status: "scheduled" | "declined" | "done") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/meeting-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "Action impossible");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return <EmptyState title="Aucune demande de rendez-vous" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {requests.map((r) => (
        <Card key={r.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{canManage ? r.requesterName : "Votre demande"}</p>
              <p className="text-xs text-navy/60">
                {new Date(r.createdAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}
                {r.preferredDate && ` · Souhaitée le ${new Date(r.preferredDate).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}`}
              </p>
            </div>
            <span className={STATUS_BADGES[r.status]}>{r.status === "pending" && r.libelleAttente ? r.libelleAttente : STATUS_LABELS[r.status]}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-navy/70">{r.reason}</p>
          {canManage && (r.status === "pending" || r.status === "scheduled") && r.peutDecider === false && r.mention && (
            <p className="text-xs text-navy/60" data-testid="mention-hierarchie">
              {r.mention}. Vous ne pouvez pas la traiter.
            </p>
          )}
          {canManage && r.peutDecider !== false && r.status === "pending" && (
            <div className="flex gap-2">
              <button className="btn-primary !px-3 !py-1.5 text-xs" disabled={busyId === r.id} onClick={() => setStatus(r.id, "scheduled")}>
                Planifier
              </button>
              <button
                className="btn-secondary !px-3 !py-1.5 text-xs text-orange-ink"
                disabled={busyId === r.id}
                onClick={() => setStatus(r.id, "declined")}
              >
                Refuser
              </button>
            </div>
          )}
          {canManage && r.peutDecider !== false && r.status === "scheduled" && (
            <button className="btn-secondary self-start !px-3 !py-1.5 text-xs" disabled={busyId === r.id} onClick={() => setStatus(r.id, "done")}>
              Marquer terminé
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}
