"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";

interface Alert {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  status: "open" | "acknowledged" | "resolved";
  notified_at: string | null;
  created_at: string;
}

const SEVERITY_BADGE: Record<Alert["severity"], string> = {
  info: "badge-teal",
  warning: "badge-gold",
  critical: "badge-orange",
};

export function AlertList({ alerts }: { alerts: Alert[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function updateStatus(id: string, status: "acknowledged" | "resolved") {
    setBusyId(id);
    try {
      await fetch(`/api/alerts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (alerts.length === 0) {
    return <EmptyState title="Aucune alerte" description="Tout est sous contrôle." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {alerts.map((alert) => (
        <Card key={alert.id} className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className={SEVERITY_BADGE[alert.severity]}>{alert.severity}</span>
              <span className="text-xs text-navy/40">{new Date(alert.created_at).toLocaleString("fr-FR")}</span>
              {!alert.notified_at && <span className="badge-neutral">Email non envoyé</span>}
            </div>
            <p className="text-sm">{alert.message}</p>
          </div>
          {alert.status === "open" && (
            <div className="flex shrink-0 gap-2">
              <button
                className="btn-secondary !px-3 !py-1.5 text-xs"
                disabled={busyId === alert.id}
                onClick={() => updateStatus(alert.id, "acknowledged")}
              >
                Prendre en compte
              </button>
              <button
                className="btn-primary !px-3 !py-1.5 text-xs"
                disabled={busyId === alert.id}
                onClick={() => updateStatus(alert.id, "resolved")}
              >
                Résoudre
              </button>
            </div>
          )}
          {alert.status !== "open" && <span className="badge-neutral shrink-0">{alert.status}</span>}
        </Card>
      ))}
    </div>
  );
}
