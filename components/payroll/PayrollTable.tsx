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
  /** Already has a payslip for the period currently shown — see page.tsx's periodStart/periodEnd. */
  payslip_generated: boolean;
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
export function PayrollTable({
  rows,
  payslipsEnabled,
  periodStart,
  periodEnd,
}: {
  rows: PayrollRow[];
  payslipsEnabled: boolean;
  periodStart: string;
  periodEnd: string;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [mealVouchers, setMealVouchers] = useState("");
  const [bonus, setBonus] = useState("");
  const [genBusyId, setGenBusyId] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  function startGenerate(row: PayrollRow) {
    setGeneratingId(row.driver_id);
    setMealVouchers("");
    setBonus("");
    setGenError(null);
  }

  function cancelGenerate() {
    setGeneratingId(null);
  }

  async function postGenerate(row: PayrollRow, mealVouchersAmount: number, bonusAmount: number): Promise<string | null> {
    const res = await fetch("/api/payslips/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: row.driver_id,
        period_start: periodStart,
        period_end: periodEnd,
        meal_vouchers_amount: mealVouchersAmount,
        bonus_amount: bonusAmount,
      }),
    });
    if (res.ok) return null;
    const json = await res.json();
    return typeof json.error === "string" ? json.error : "Erreur";
  }

  async function generateOne(row: PayrollRow) {
    setGenBusyId(row.driver_id);
    setGenError(null);
    const err = await postGenerate(row, mealVouchers.trim() === "" ? 0 : Number(mealVouchers), bonus.trim() === "" ? 0 : Number(bonus));
    setGenBusyId(null);
    if (err) {
      setGenError(err);
      return;
    }
    setGeneratingId(null);
    router.refresh();
  }

  /** "Génération générale sauf celles déjà faites" — pas de paniers/primes ici, par construction : toute exception individuelle passe par le bouton par chauffeur. */
  async function generateAllMissing() {
    const targets = rows.filter((r) => !r.payslip_generated && r.monthly_gross_salary !== null && r.monthly_net_salary !== null);
    const skippedNoSalary = rows.filter((r) => !r.payslip_generated && (r.monthly_gross_salary === null || r.monthly_net_salary === null)).length;
    setBulkBusy(true);
    setBulkSummary(null);
    let created = 0;
    let failed = 0;
    for (const row of targets) {
      const err = await postGenerate(row, 0, 0);
      if (err) failed++;
      else created++;
    }
    setBulkBusy(false);
    setBulkSummary(
      `${created} fiche(s) générée(s)` +
        (failed > 0 ? `, ${failed} échec(s)` : "") +
        (skippedNoSalary > 0 ? `, ${skippedNoSalary} ignoré(s) (salaire non renseigné)` : ""),
    );
    if (created > 0) router.refresh();
  }

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

  const missingCount = rows.filter((r) => !r.payslip_generated && r.monthly_gross_salary !== null && r.monthly_net_salary !== null).length;

  return (
    <Card className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-orange-ink">{error}</p>}
      {payslipsEnabled && (
        <div className="mb-3 flex items-center gap-3">
          <button className="btn-secondary !px-3 !py-1.5 text-sm" disabled={bulkBusy || missingCount === 0} onClick={generateAllMissing}>
            {bulkBusy ? "Génération…" : `Générer les fiches manquantes (${missingCount})`}
          </button>
          {bulkSummary && <p className="text-xs text-navy/70">{bulkSummary}</p>}
        </div>
      )}
      <table className="w-full min-w-[980px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Chauffeur</th>
            <th className="pb-2">Tournées</th>
            <th className="pb-2">Heures travaillées</th>
            <th className="pb-2">Salaire mensuel (brut / net)</th>
            <th className="pb-2">Heures contract./mois</th>
            <th className="pb-2">Taux horaire (brut / net)</th>
            <th className="pb-2">Estimé sur la période (brut / net)</th>
            <th className="pb-2" />
            {payslipsEnabled && <th className="pb-2">Fiche de paie</th>}
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
                          aria-label="Salaire brut" placeholder="Brut"
                          value={edit.monthlyGross}
                          onChange={(e) => setEdit({ ...edit, monthlyGross: e.target.value })}
                        />
                        <input
                          className="input !h-7 !w-20 !py-0.5 !text-xs"
                          type="number"
                          min={0}
                          step={0.01}
                          aria-label="Salaire net" placeholder="Net"
                          value={edit.monthlyNet}
                          onChange={(e) => setEdit({ ...edit, monthlyNet: e.target.value })}
                        />
                      </div>
                    </td>
                    <td className="py-2">
                      <input aria-label="Heures contractuelles"
                        className="input !h-7 !w-20 !py-0.5 !text-xs"
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={edit.contractualHours}
                        onChange={(e) => setEdit({ ...edit, contractualHours: e.target.value })}
                      />
                    </td>
                    <td className="py-2 text-navy/60">—</td>
                    <td className="py-2 text-navy/60">—</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button className="btn-primary !h-6 !px-2 !py-0 !text-xs" disabled={busyId === row.driver_id} onClick={() => save(row)}>
                          OK
                        </button>
                        <button className="btn-secondary !h-6 !px-2 !py-0 !text-xs" disabled={busyId === row.driver_id} onClick={cancelEdit}>
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
                      <button className="text-navy/60 hover:text-teal-ink" onClick={() => startEdit(row)} aria-label="Modifier" title="Modifier">
                        ✎
                      </button>
                    </td>
                  </>
                )}
                {payslipsEnabled && (
                  <td className="py-2">
                    {row.payslip_generated ? (
                      <span className="badge-teal">✓ Générée</span>
                    ) : row.monthly_gross_salary === null || row.monthly_net_salary === null ? (
                      <span className="text-xs text-navy/60" title="Renseignez le salaire brut/net pour générer une fiche">
                        Salaire non renseigné
                      </span>
                    ) : generatingId === row.driver_id ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-1">
                          <input
                            className="input !h-7 !w-24 !py-0.5 !text-xs"
                            type="number"
                            min={0}
                            step={0.01}
                            aria-label="Panier repas €" placeholder="Panier repas €"
                            value={mealVouchers}
                            onChange={(e) => setMealVouchers(e.target.value)}
                          />
                          <input
                            className="input !h-7 !w-20 !py-0.5 !text-xs"
                            type="number"
                            min={0}
                            step={0.01}
                            aria-label="Prime €" placeholder="Prime €"
                            value={bonus}
                            onChange={(e) => setBonus(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-1">
                          <button
                            className="btn-primary !h-6 !px-2 !py-0 !text-xs"
                            disabled={genBusyId === row.driver_id}
                            onClick={() => generateOne(row)}
                          >
                            {genBusyId === row.driver_id ? "…" : "Générer"}
                          </button>
                          <button className="btn-secondary !h-6 !px-2 !py-0 !text-xs" disabled={genBusyId === row.driver_id} onClick={cancelGenerate}>
                            Annuler
                          </button>
                        </div>
                        {genError && <p role="alert" className="text-xs text-orange-ink">{genError}</p>}
                      </div>
                    ) : (
                      <button className="btn-secondary !h-7 !px-2 !py-0.5 !text-xs" onClick={() => startGenerate(row)}>
                        💶 Générer fiche
                      </button>
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
