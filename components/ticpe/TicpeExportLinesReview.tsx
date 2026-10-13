"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconCheck, IconPencil } from "@/components/layout/icons";

export interface TicpeExportLine {
  id: string;
  registration: string;
  vehicle_type: string;
  entry_count: number;
  computed_total_liters: number;
  computed_total_amount: number;
  corrected_total_liters: number | null;
  corrected_total_amount: number | null;
  status: "pending" | "confirmed" | "corrected";
}

const STATUS_BADGE: Record<TicpeExportLine["status"], string> = {
  pending: "badge-neutral",
  confirmed: "badge-teal",
  corrected: "badge-gold",
};
const STATUS_LABEL: Record<TicpeExportLine["status"], string> = {
  pending: "À vérifier",
  confirmed: "Correct",
  corrected: "Corrigé",
};

export function TicpeExportLinesReview({ lines }: { lines: TicpeExportLine[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [litersValue, setLitersValue] = useState("");
  const [amountValue, setAmountValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function startEdit(line: TicpeExportLine) {
    setEditingId(line.id);
    setLitersValue((line.corrected_total_liters ?? line.computed_total_liters).toString());
    setAmountValue((line.corrected_total_amount ?? line.computed_total_amount).toString());
    setError(null);
  }

  async function confirm(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/ticpe/export-lines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
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

  async function saveCorrection(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/ticpe/export-lines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "correct", corrected_total_liters: Number(litersValue), corrected_total_amount: Number(amountValue) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Véhicule</th>
            <th className="pb-2">Pleins</th>
            <th className="pb-2">Litres</th>
            <th className="pb-2">Coût d&apos;achat TTC</th>
            <th className="pb-2">Statut</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const isEditing = editingId === l.id;
            const liters = l.corrected_total_liters ?? l.computed_total_liters;
            const amount = l.corrected_total_amount ?? l.computed_total_amount;
            return (
              <tr key={l.id} className="border-t border-navy/5 align-top">
                <td className="py-2">
                  {l.registration} ({l.vehicle_type})
                </td>
                <td className="py-2">{l.entry_count}</td>
                <td className="py-2">
                  {isEditing ? (
                    <input aria-label="Litres" className="input !w-24 !py-1" type="number" value={litersValue} onChange={(e) => setLitersValue(e.target.value)} />
                  ) : (
                    `${liters.toLocaleString("fr-FR")} L`
                  )}
                </td>
                <td className="py-2">
                  {isEditing ? (
                    <input aria-label="Coût d'achat TTC (€)" className="input !w-24 !py-1" type="number" value={amountValue} onChange={(e) => setAmountValue(e.target.value)} />
                  ) : (
                    `${amount.toLocaleString("fr-FR")} €`
                  )}
                </td>
                <td className="py-2">
                  <span className={STATUS_BADGE[l.status]}>{STATUS_LABEL[l.status]}</span>
                </td>
                <td className="py-2">
                  {isEditing ? (
                    <div className="flex gap-2">
                      <button className="btn-primary !px-2 !py-1 text-xs" disabled={busyId === l.id || !(Number(litersValue) > 0) || !(Number(amountValue) > 0)} onClick={() => saveCorrection(l.id)}>
                        Enregistrer
                      </button>
                      <button className="text-xs text-navy/60" disabled={busyId === l.id} onClick={() => setEditingId(null)}>
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busyId === l.id} onClick={() => confirm(l.id)}>
                        <IconCheck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Correct
                      </button>
                      <button className="btn-secondary !px-2 !py-1 text-xs" disabled={busyId === l.id} onClick={() => startEdit(l)}>
                        <IconPencil className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Corriger
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
