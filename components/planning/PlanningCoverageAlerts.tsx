"use client";

import { useEffect, useState } from "react";

type CoverageAlert = {
  type: string;
  severity: string;
  date: string;
  service: string;
  tour_number: string;
  message: string;
  entry_id: string;
};

export function PlanningCoverageAlerts({ start, end }: { start: string; end: string }) {
  const [alerts, setAlerts] = useState<CoverageAlert[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/planning/coverage-alerts?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Vérification impossible");
        if (!cancelled) setAlerts(Array.isArray(json.alerts) ? json.alerts : []);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Vérification impossible"); });
    return () => { cancelled = true; };
  }, [start, end]);

  if (error) return <div role="status" className="mb-4 rounded-xl border border-orange/30 p-3 text-sm">Contrôle du planning indisponible : {error}</div>;
  if (!alerts.length) return null;

  return (
    <section aria-label="Alertes de couverture du planning" className="mb-4 rounded-2xl border border-orange/30 bg-orange/[0.06] p-4">
      <h2 className="text-base font-semibold">{alerts.length} alerte{alerts.length > 1 ? "s" : ""} à vérifier dans le planning</h2>
      <p className="mt-1 text-sm text-navy/65">Tournées habituelles manquantes, affectations sans chauffeur ou congés approuvés.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {alerts.map((a, i) => (
          <li key={a.entry_id || `${a.date}-${a.service}-${a.tour_number}-${i}`} className="rounded-xl bg-surface px-3 py-2 text-sm">
            <strong>{a.date.split("-").reverse().join("/")} · {a.service} · tournée n°{a.tour_number}</strong>
            <p className="text-navy/70">{a.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
