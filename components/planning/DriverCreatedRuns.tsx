"use client";

import Link from "next/link";

type DriverCreatedRun = {
  id: string;
  name: string | null;
  run_date: string;
  status: string;
  driver_id: string;
};

const STATUS_LABEL: Record<string, string> = {
  loading: "À préparer",
  in_progress: "En cours",
  done: "Terminée",
};

export function DriverCreatedRuns({
  runs,
  driverNames,
}: {
  runs: DriverCreatedRun[];
  driverNames: Record<string, string>;
}) {
  if (runs.length === 0) return null;

  return (
    <section className="mb-5 rounded-xl border border-amber-300/60 bg-amber-50/60 p-4">
      <h2 className="font-semibold text-navy">Fiches Tournée Colis créées par les chauffeurs</h2>
      <p className="mt-1 text-sm text-navy/70">
        Ces fiches quotidiennes ne sont pas des affectations Planning. Vérifiez-les ici puis créez l’affectation correspondante si nécessaire.
      </p>
      <ul className="mt-3 divide-y divide-navy/10">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
            <div>
              <p className="text-sm font-medium text-navy">{run.name || "Tournée sans nom"}</p>
              <p className="text-xs text-navy/65">
                {driverNames[run.driver_id] || "Chauffeur"} · {run.run_date.split("-").reverse().join("/")} · {STATUS_LABEL[run.status] || run.status}
              </p>
            </div>
            <Link className="btn-secondary !px-3 !py-1.5 text-sm" href={`/exploitation/historique/colis?tournee=${encodeURIComponent(run.id)}`}>
              Ouvrir la fiche
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
