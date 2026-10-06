"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

export interface PayrollRow {
  driver_id: string;
  full_name: string;
  hourly_rate: number | null;
  tours_count: number;
  worked_hours: number;
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h${m.toString().padStart(2, "0")}`;
}

/**
 * hourly_rate is edited right here rather than on the driver's own
 * admin/users/[id] page — this is the one place direction actually
 * looks at it alongside the computed salary, while reading the
 * contract to set or adjust it ("au cas par cas").
 */
export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function rateValue(row: PayrollRow): string {
    return edits[row.driver_id] ?? (row.hourly_rate !== null ? String(row.hourly_rate) : "");
  }

  function isDirty(row: PayrollRow): boolean {
    const edited = edits[row.driver_id];
    if (edited === undefined) return false;
    return edited !== (row.hourly_rate !== null ? String(row.hourly_rate) : "");
  }

  async function saveRate(row: PayrollRow) {
    const raw = edits[row.driver_id];
    const value = raw === undefined || raw.trim() === "" ? null : Number(raw);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      setError("Taux horaire invalide.");
      return;
    }
    setBusyId(row.driver_id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${row.driver_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hourly_rate: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setEdits((prev) => {
        const next = { ...prev };
        delete next[row.driver_id];
        return next;
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p className="mb-2 text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[700px] text-sm">
        <thead className="text-left text-navy/40">
          <tr>
            <th className="pb-2">Chauffeur</th>
            <th className="pb-2">Tournées</th>
            <th className="pb-2">Heures travaillées</th>
            <th className="pb-2">Taux horaire (€)</th>
            <th className="pb-2">Salaire estimé</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const salary = row.hourly_rate !== null ? row.worked_hours * row.hourly_rate : null;
            return (
              <tr key={row.driver_id} className="border-t border-navy/5">
                <td className="py-2">{row.full_name}</td>
                <td className="py-2">{row.tours_count}</td>
                <td className="py-2">{formatHours(row.worked_hours)}</td>
                <td className="py-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      className="input !h-7 !w-20 !py-0.5 !text-xs"
                      type="number"
                      min={0}
                      step={0.01}
                      value={rateValue(row)}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [row.driver_id]: e.target.value }))}
                    />
                    {isDirty(row) && (
                      <button
                        className="btn-primary !h-6 !px-2 !py-0 !text-[11px]"
                        disabled={busyId === row.driver_id}
                        onClick={() => saveRate(row)}
                      >
                        OK
                      </button>
                    )}
                  </div>
                </td>
                <td className="py-2">
                  {salary !== null ? `${salary.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
