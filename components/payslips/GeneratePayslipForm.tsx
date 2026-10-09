"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function firstAndLastOfMonth(monthValue: string): { start: string; end: string } {
  const [yearStr, monthStr] = monthValue.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function GeneratePayslipForm({ employees }: { employees: { id: string; full_name: string }[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState(employees[0]?.id ?? "");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const { start, end } = firstAndLastOfMonth(month);
      const res = await fetch("/api/payslips/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, period_start: start, period_end: end }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="label">Employé</label>
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">Mois</label>
        <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <button className="btn-primary" disabled={busy || !userId} onClick={generate}>
        {busy ? "Génération…" : "Générer le bulletin"}
      </button>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
    </div>
  );
}
