"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { resolveAlertUrl } from "@/lib/alerts/resolve-url";
import { etatAlerte, libelleGravite, libelleStatutAlerte } from "@/lib/alerts/lecture";
import type { UserRole } from "@/lib/types/domain";

interface Alert {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  status: "open" | "acknowledged" | "resolved";
  notified_at?: string | null;
  created_at: string;
  related_table: string | null;
  related_id: string | null;
  recipient_user_id?: string | null;
  /** Lue par la personne connectée (alert_reads). Absent : non suivi. */
  lu?: boolean;
}

const SEVERITY_BADGE: Record<Alert["severity"], string> = {
  info: "badge-teal",
  warning: "badge-gold",
  critical: "badge-orange",
};

/**
 * Notifications de la personne connectée. « Marquer comme lu » est
 * personnel (alert_reads, comme la cloche) et ouvert à tous, chauffeur
 * compris : son compteur de non lues baisse. « Prendre en compte » et
 * « Résoudre » changent le statut partagé de l'alerte : c'est une
 * décision de l'encadrement, pas du chauffeur (la RLS limite déjà les
 * alertes que chacun voit).
 */
export function AlertList({
  alerts,
  viewerRole,
  conduit,
  modules,
}: {
  alerts: Alert[];
  viewerRole: UserRole;
  /** La personne conduit (lien d'un rappel personnel de planning, par exemple). */
  conduit?: boolean;
  /** Modules actifs : le lien ne mène qu'à un écran qui s'ouvre. */
  modules?: readonly string[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const canAct = viewerRole !== "chauffeur";
  const nonLues = alerts.filter((a) => a.lu === false).map((a) => a.id);

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

  async function marquerLu(ids: string[], cle: string) {
    if (ids.length === 0) return;
    setBusyId(cle);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (alerts.length === 0) {
    return <EmptyState title="Aucune notification" description="Tout est sous contrôle." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {nonLues.length > 1 && (
        <div className="flex justify-end">
          <button type="button" className="btn-secondary min-h-[44px] text-sm" disabled={busyId === "tout"} onClick={() => marquerLu(nonLues, "tout")}>
            Tout marquer comme lu ({nonLues.length})
          </button>
        </div>
      )}
      {alerts.map((alert) => {
        const lien = resolveAlertUrl(alert.related_table, alert.type, alert.related_id, {
          recipientUserId: alert.recipient_user_id,
          role: viewerRole,
          conduit,
          modules,
        });
        return (
          <Card key={alert.id} className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${alert.lu === false ? "border-l-4 border-l-teal" : ""}`}>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                {alert.lu === false && <span className="badge-teal">Nouveau</span>}
                <span className={SEVERITY_BADGE[alert.severity]}>{libelleGravite(alert.severity)}</span>
                <span className="text-xs text-navy/60">{new Date(alert.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</span>
              </div>
              <p className={`text-sm ${alert.lu === false ? "font-semibold" : ""}`}>{alert.message}</p>
              {lien && (
                <Link href={lien} className="mt-1 inline-flex min-h-[44px] items-center text-sm text-teal-ink underline">
                  Voir →
                </Link>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {alert.lu === false && (
                <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" disabled={busyId === alert.id} onClick={() => marquerLu([alert.id], alert.id)}>
                  Marquer comme lu
                </button>
              )}
              {alert.status === "open" && canAct && (
                <>
                  <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" disabled={busyId === alert.id} onClick={() => updateStatus(alert.id, "acknowledged")}>
                    Prendre en compte
                  </button>
                  <button type="button" className="btn-primary min-h-[44px] !px-3 text-sm" disabled={busyId === alert.id} onClick={() => updateStatus(alert.id, "resolved")}>
                    Résoudre
                  </button>
                </>
              )}
              {alert.status !== "open" && <span className="badge-neutral">{libelleStatutAlerte(alert.status)}</span>}
              {alert.lu === true && etatAlerte(alert.status, alert.lu) === "lue" && <span className="badge-neutral">Lue · {libelleStatutAlerte(alert.status).toLowerCase()}</span>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
