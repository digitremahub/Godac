"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { AttachReportPhotoButton } from "@/components/reports/AttachReportPhotoButton";
import { IconPencil } from "@/components/layout/icons";

export interface TourHistoryRow {
  id: string;
  dateLabel: string;
  driverName: string | null;
  serviceName: string;
  vehicleRegistration: string;
  tourNumber: string;
  scheduleLabel: string;
  startKm: number | null;
  endKm: number | null;
  startPhotoPath: string | null;
  endPhotoPath: string | null;
  returnLabel: string;
  returnDeltaLabel: string | null;
  statusLabel: string;
}

/**
 * Km inline-editable for direction only — a driver can mistype (or, in
 * testing, a placeholder value can get left behind) and there's no
 * other way to correct an already-closed tour's recorded km once it's
 * no longer "in_progress" (app/api/tours/[id] only lets the driver
 * close their own open tour). PATCHes app/api/reports/[id], which
 * already lets direction edit any planning_entries row — km is just
 * another field on the same route.
 */
export function TourHistoryTable({ rows, showDriverColumn, canEditKm }: { rows: TourHistoryRow[]; showDriverColumn: boolean; canEditKm: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [startKm, setStartKm] = useState("");
  const [endKm, setEndKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(row: TourHistoryRow) {
    setEditingId(row.id);
    setStartKm(row.startKm !== null ? String(row.startKm) : "");
    setEndKm(row.endKm !== null ? String(row.endKm) : "");
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function save(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_km: startKm.trim() === "" ? null : Number(startKm),
          end_km: endKm.trim() === "" ? null : Number(endKm),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[820px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Date</th>
            {showDriverColumn && <th className="pb-2">Chauffeur</th>}
            <th className="pb-2">Service</th>
            <th className="pb-2">Véhicule</th>
            <th className="pb-2">Tournée</th>
            <th className="pb-2">Horaires</th>
            <th className="pb-2">Km</th>
            <th className="pb-2">Retour</th>
            <th className="pb-2">Statut</th>
            {canEditKm && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const editing = editingId === r.id;
            return (
              <tr key={r.id} className="border-t border-navy/5">
                <td className="py-2">{r.dateLabel}</td>
                {showDriverColumn && <td className="py-2">{r.driverName ?? "—"}</td>}
                <td className="py-2">{r.serviceName}</td>
                <td className="py-2">{r.vehicleRegistration}</td>
                <td className="py-2">n°{r.tourNumber}</td>
                <td className="py-2">{r.scheduleLabel}</td>
                <td className="py-2">
                  {editing ? (
                    <div className="flex items-center gap-1">
                      <input
                        className="input !h-7 !w-16 !py-0.5 !text-xs"
                        type="number"
                        min={0}
                        aria-label="Km au départ" placeholder="Départ"
                        value={startKm}
                        onChange={(e) => setStartKm(e.target.value)}
                      />
                      <span className="text-navy/60">→</span>
                      <input
                        className="input !h-7 !w-16 !py-0.5 !text-xs"
                        type="number"
                        min={0}
                        aria-label="Km au retour" placeholder="Retour"
                        value={endKm}
                        onChange={(e) => setEndKm(e.target.value)}
                      />
                    </div>
                  ) : r.startKm !== null ? (
                    `${r.startKm}${r.endKm !== null ? ` → ${r.endKm}` : ""} km`
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-2">
                  {r.returnLabel}
                  {r.returnDeltaLabel && <span className="ml-1 text-xs text-navy/60">{r.returnDeltaLabel}</span>}
                </td>
                <td className="py-2">{r.statusLabel}</td>
                {canEditKm && (
                  <td className="py-2">
                    {editing ? (
                      <div className="flex gap-1">
                        <button className="btn-primary !h-6 !px-2 !py-0 !text-xs" disabled={busy} onClick={() => save(r.id)}>
                          OK
                        </button>
                        <button className="btn-secondary !h-6 !px-2 !py-0 !text-xs" disabled={busy} onClick={cancelEdit}>
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <button className="text-navy/60 hover:text-teal-ink" onClick={() => startEdit(r)} aria-label="Modifier les km" title="Modifier les km">
                          <IconPencil className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Km
                        </button>
                        {!r.startPhotoPath && <AttachReportPhotoButton planningEntryId={r.id} stage="start" />}
                        {!r.endPhotoPath && <AttachReportPhotoButton planningEntryId={r.id} stage="end" />}
                      </div>
                    )}
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
