"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  serviceName: string | null;
  authorName: string;
  requiresAcknowledgement: boolean;
  createdAt: string;
  isRead: boolean;
  readCount: number | null;
}

export function AnnouncementsList({ announcements }: { announcements: AnnouncementRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function markRead(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/announcements/${id}/read`, { method: "POST" });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (announcements.length === 0) {
    return <EmptyState title="Aucune annonce" description="Les notes de service et convocations apparaîtront ici." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {announcements.map((a) => (
        <Card key={a.id} className={a.requiresAcknowledgement && !a.isRead ? "border-gold/40" : ""}>
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg">{a.title}</h3>
              <p className="text-xs text-white/40">
                {a.authorName} · {a.serviceName ?? "Toute l'organisation"} · {new Date(a.createdAt).toLocaleString("fr-FR")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {a.requiresAcknowledgement && (
                <span className={a.isRead ? "badge-teal" : "badge-gold"}>{a.isRead ? "Lu" : "Non lu"}</span>
              )}
              {a.readCount !== null && <span className="badge-neutral">{a.readCount} lecture(s)</span>}
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm text-white/70">{a.body}</p>
          {a.requiresAcknowledgement && !a.isRead && (
            <button className="btn-primary mt-3 !px-3 !py-1.5 text-sm" disabled={busyId === a.id} onClick={() => markRead(a.id)}>
              {busyId === a.id ? "…" : "Marquer comme lu"}
            </button>
          )}
        </Card>
      ))}
    </div>
  );
}
