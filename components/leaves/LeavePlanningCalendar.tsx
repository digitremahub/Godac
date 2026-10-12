"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { monthCalendarDays, addMonths } from "@/lib/planning/dates";
import { IconAlertTriangle } from "@/components/layout/icons";

interface LeaveRow {
  id: string;
  driverId: string;
  driverName: string;
  serviceName: string;
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "rejected";
  replacementDriverId: string | null;
  replacementName: string | null;
}
interface DriverOption {
  id: string;
  full_name: string;
}

const STATUS_LABELS: Record<string, string> = { pending: "En attente", approved: "Approuvé", rejected: "Refusé" };
const STATUS_BADGES: Record<string, string> = { pending: "badge-gold", approved: "badge-teal", rejected: "badge-neutral" };

function overlapsDay(leave: LeaveRow, day: string): boolean {
  return leave.startDate <= day && leave.endDate >= day;
}

/**
 * Month-grid overview (who's away, at a glance) plus a flat list
 * below for the actual work — assigning a replacement driver per
 * approved leave. Kept separate from /planning on purpose: this is
 * absence coverage, not tours/vehicles, and direction is the only
 * role that needs the org-wide picture (managers already decide
 * individual requests from /leaves).
 */
export function LeavePlanningCalendar({
  month,
  leaves,
  drivers,
}: {
  month: string;
  leaves: LeaveRow[];
  drivers: DriverOption[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = monthCalendarDays(month);
  const [year, monthNum] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];

  function navTo(nextMonth: string) {
    router.push(`/leaves/planning?month=${nextMonth}`);
  }

  async function setReplacement(leaveId: string, replacementDriverId: string) {
    setBusyId(leaveId);
    setError(null);
    try {
      const res = await fetch(`/api/leaves/${leaveId}/replacement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacement_driver_id: replacementDriverId || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  const approvedWithoutReplacement = leaves.filter((l) => l.status === "approved" && !l.replacementDriverId).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addMonths(month, -1))}>
          ← Mois préc.
        </button>
        <span className="text-sm text-navy/70">
          {new Date(year, monthNum - 1, 1).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", month: "long", year: "numeric" })}
        </span>
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addMonths(month, 1))}>
          Mois suiv. →
        </button>
      </div>

      {approvedWithoutReplacement > 0 && (
        <p className="rounded-lg bg-gold/10 p-3 text-sm text-gold-ink">
          <IconAlertTriangle className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> {approvedWithoutReplacement} congé(s) approuvé(s) sans remplaçant assigné ce mois-ci.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((l) => (
          <div key={l} className="px-1 text-navy/60">
            {l}
          </div>
        ))}
        {days.map((day) => {
          const dayLeaves = leaves.filter((l) => l.status === "approved" && overlapsDay(l, day));
          const inMonth = day.slice(0, 7) === month;
          return (
            <div
              key={day}
              className={`flex min-h-[64px] flex-col gap-0.5 rounded-lg border border-navy/10 p-1.5 ${
                inMonth ? "bg-white" : "bg-navy/[0.04] text-navy/60"
              }`}
            >
              <span className="font-medium">{Number(day.slice(8, 10))}</span>
              {dayLeaves.slice(0, 2).map((l) => (
                <span
                  key={l.id}
                  className={`truncate rounded px-1 text-[11px] ${l.replacementDriverId ? "bg-teal/15 text-navy/70" : "bg-orange-ink/15 text-orange-ink"}`}
                >
                  {l.driverName.split(" ")[0]}
                </span>
              ))}
              {dayLeaves.length > 2 && <span className="text-[11px] text-navy/60">+{dayLeaves.length - 2}</span>}
            </div>
          );
        })}
      </div>

      {leaves.length === 0 ? (
        <EmptyState title="Aucun congé ce mois-ci" />
      ) : (
        <div className="flex flex-col gap-2">
          {leaves.map((l) => (
            <Card key={l.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {l.driverName} <span className="text-xs text-navy/60">({l.serviceName})</span>
                </p>
                <p className="text-xs text-navy/65">
                  {new Date(l.startDate).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} → {new Date(l.endDate).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}
                </p>
              </div>
              <span className={STATUS_BADGES[l.status]}>{STATUS_LABELS[l.status]}</span>
              {l.status === "approved" && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-navy/65">Remplaçant</label>
                  <select aria-label="Remplaçant"
                    className="input !w-auto !py-1 text-xs"
                    value={l.replacementDriverId ?? ""}
                    disabled={busyId === l.id}
                    onChange={(e) => setReplacement(l.id, e.target.value)}
                  >
                    <option value="">Aucun</option>
                    {drivers
                      .filter((d) => d.id !== l.driverId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
