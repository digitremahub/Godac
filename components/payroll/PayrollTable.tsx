"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { computeHourlyRates, estimateSalary, type HourlyRates } from "@/lib/business/payroll";

export interface PayrollRow {
  driver_id: string;
  full_name: string;
  monthly_gross_salary: number | null;
  monthly_net_salary: number | null;
  contractual_monthly_hours: number;
  hourly_rates: HourlyRates | null;
  tours_count: number;
  worked_hours: number;
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h${m.toString().padStart(2, "0")}`;
}

function formatEuros(value: number): string {
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

interface EditState {
  monthlyGross: string;
  monthlyNet: string;
  contractualHours: string;
}

function toEditState(row: PayrollRow): EditState {
  return {
    monthlyGross: row.monthly_gross_salary !== null ? String(row.monthly_gross_salary) : "",
    monthlyNet: row.monthly_net_salary !== null ? String(row.monthly_net_salary) : "",
    contractualHours: String(row.contractual_monthly_hours),
  };
}

/**
 * Le taux horaire n'est plus saisi directement — il se déduit du
 * salaire mensuel brut/net et des heures contractuelles, lus sur le
 * contrat (lib/business/payroll.ts). Direction modifie ces trois
 * champs ici même, là où elle regarde déjà le salaire estimé — pas sur
 * la fiche du chauffeur, qu'elle n'a pas forcément ouverte.
 */
export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startEdit(row: PayrollRow) {
    setEditingId(row.driver_id);
    setEdit(toEditState(row));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEdit(null);
  }

  async function save(row: PayrollRow) {
    if (!edit) return;
    const monthlyGross = edit.monthlyGross.trim() === "" ? null : Number(edit.monthlyGross);
    const monthlyNet = edit.monthlyNet.trim() === "" ? null : Number(edit.monthlyNet);
    const contractualHours = Number(edit.contractualHours);
    if ([monthlyGross, monthlyNet].some((v) => v !== null && (Number.isNaN(v) || v < 0))) {
      setError("Salaire invalide.");
      return;
    }
    if (Number.isNaN(contractualHours) || contractualHours <= 0) {
      setError("Heures contractuelles invalides.");
      return;
    }
    setBusyId(row.driver_id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${row.driver_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthly_gross_salary: monthlyGross,
          monthly_net_salary: monthlyNet,
          contractual_monthly_hours: contractualHours,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setEditingId(null);
      setEdit(null);
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
      <table className="w-full min-w-[980px] text-sm">
        <thead className="text-left text-navy/40">
          <tr>
            <th className="pb-2">Chauffeur</th>
            <th className="pb-2">Tournées</th>
            <th className="pb-2">Heures travaillées</th>
            <th className="pb-2">Salaire mensuel (brut / net)</th>
            <th className="pb-2">Heures contract./mois</th>
            <th className="pb-2">Taux horaire (brut / net)</th>
            <th className="pb-2">Estimé sur la période (brut / net)</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const editing = editingId === row.driver_id;
            const rates = row.hourly_rates ?? computeHourlyRates({
              monthlyGrossSalary: row.monthly_gross_salary,
              monthlyNetSalary: row.monthly_net_salary,
              contractualMonthlyHours: row.contractual_monthly_hours,
            });
            const estimate = estimateSalary(row.worked_hours, rates);
            return (
              <tr key={row.driver_id} className="border-t border-navy/5">
                <td className="py-2">{row.full_name}</td>
                <td className="py-2">{row.tours_count}</td>
                <td className="py-2">{formatHours(row.worked_hours)}</td>
                {editing && edit ? (
                  <>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <input
                          className="input !h-7 !w-20 !py-0.5 !text-xs"
                          type="number"
                          min={0}
                          step={0.01}
                          placeholder="Brut"
                          value={edit.monthlyGross}
                          onChange={(e) => setEdit({ ...edit, monthlyGross: e.target.value })}
                        />
                        <input
                          className="input !h-7 !w-20 !py-0.5 !text-xs"
                          type="number"
                          min={0}
                          step={0.01}
                          placeholder="Net"
                          value={edit.monthlyNet}
                          onChange={(e) => setEdit({ ...edit, monthlyNet: e.target.value })}
                        />
                      </div>
                    </td>
                    <td className="py-2">
                      <input
                        className="input !h-7 !w-20 !py-0.5 !text-xs"
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={edit.contractualHours}
                        onChange={(e) => setEdit({ ...edit, contractualHours: e.target.value })}
                      />
                    </td>
                    <td className="py-2 text-navy/30">—</td>
                    <td className="py-2 text-navy/30">—</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button className="btn-primary !h-6 !px-2 !py-0 !text-[11px]" disabled={busyId === row.driver_id} onClick={() => save(row)}>
                          OK
                        </button>
                        <button className="btn-secondary !h-6 !px-2 !py-0 !text-[11px]" disabled={busyId === row.driver_id} onClick={cancelEdit}>
                          Annuler
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="py-2">
                      {row.monthly_gross_salary !== null || row.monthly_net_salary !== null
                        ? `${row.monthly_gross_salary !== null ? formatEuros(row.monthly_gross_salary) : "—"} / ${row.monthly_net_salary !== null ? formatEuros(row.monthly_net_salary) : "—"}`
                        : "—"}
                    </td>
                    <td className="py-2">{row.contractual_monthly_hours} h</td>
                    <td className="py-2">
                      {rates
                        ? `${rates.grossPerHour !== null ? `${formatEuros(rates.grossPerHour)}/h` : "—"} / ${rates.netPerHour !== null ? `${formatEuros(rates.netPerHour)}/h` : "—"}`
                        : "—"}
                    </td>
                    <td className="py-2">
                      {estimate
                        ? `${estimate.gross !== null ? formatEuros(estimate.gross) : "—"} / ${estimate.net !== null ? formatEuros(estimate.net) : "—"}`
                        : "—"}
                    </td>
                    <td className="py-2">
                      <button className="text-navy/30 hover:text-teal-ink" onClick={() => startEdit(row)} aria-label="Modifier" title="Modifier">
                        ✎
                      </button>
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
