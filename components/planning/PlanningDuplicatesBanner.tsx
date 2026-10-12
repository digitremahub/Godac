"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { networkErrorMessage } from "@/lib/utils/network-error";

export interface DuplicateRow {
  id: string;
  label: string;
  reason: string;
}

/** Direction-only list of duplicated planned entries, each with its own delete button. */
export function PlanningDuplicatesBanner({ duplicates }: { duplicates: DuplicateRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(d: DuplicateRow) {
    if (!confirm(`Supprimer le doublon « ${d.label} » ?`)) return;
    setBusyId(d.id);
    setError(null);
    try {
      const res = await fetch(`/api/planning/entries/${d.id}/remove-duplicate`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Suppression impossible");
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section aria-label="Doublons détectés" className="mb-4 rounded-2xl border border-orange/30 bg-orange/[0.06] p-4">
      <h2 className="text-base">
        {duplicates.length} doublon{duplicates.length > 1 ? "s" : ""} dans le planning
      </h2>
      <p className="mt-0.5 text-sm text-navy/65">Affectations prévues en double d&apos;une tournée déjà effectuée ou déjà prévue le même jour.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {duplicates.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-sm shadow-card">
            <span>
              <strong>{d.label}</strong>
              <span className="text-navy/60"> — {d.reason}</span>
            </span>
            <button type="button" className="btn-danger !px-3 !py-1.5 text-xs" disabled={busyId !== null} onClick={() => remove(d)}>
              {busyId === d.id ? "Suppression…" : "Supprimer"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-orange-ink">{error}</p>}
    </section>
  );
}
