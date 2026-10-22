"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Option {
  id: string;
  label: string;
}

/**
 * Vehicle/driver filters for /carburant/pleins — this is also the closest thing
 * GODAC has today to a "planning" view: sort by picking a vehicle to
 * see who's had it and when, or a driver to see which vehicles they
 * used each day (planning_entries would be the built-for-purpose
 * table, but it has no data — nobody assigns tours there yet — so
 * fuel_entries, populated by every real ravitaillement, is the
 * actual source of truth for "who had what, when").
 */
export function FuelHistoryFilters({
  vehicles,
  drivers,
  aTraiter = null,
}: {
  vehicles: Option[];
  drivers: Option[] | null;
  /** Nombre GLOBAL d'écarts à traiter (encadrement) ; null : pas de filtre « À traiter ». */
  aTraiter?: number | null;
}) {

  const router = useRouter();
  const searchParams = useSearchParams();
  const filtreActif = searchParams.get("a_traiter") === "1";

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Nouveau filtre : on repart de la première page.
    params.delete("page");
    router.push(`/carburant/pleins?${params.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-3">
      {aTraiter !== null && (
        <div role="group" aria-label="Pleins affichés" className="flex rounded-xl border border-navy/[0.12] bg-surface p-1">
          <button type="button" aria-pressed={!filtreActif} className={`min-h-[40px] rounded-lg px-3 text-sm font-semibold ${!filtreActif ? "bg-navy/[0.08] text-navy" : "text-navy/65"}`} onClick={() => setParam("a_traiter", "")}>
            Tous
          </button>
          <button type="button" aria-pressed={filtreActif} className={`min-h-[40px] rounded-lg px-3 text-sm font-semibold ${filtreActif ? "bg-navy/[0.08] text-navy" : "text-navy/65"}`} onClick={() => setParam("a_traiter", "1")}>
            À traiter{" "}
            <span className={aTraiter > 0 ? "badge-orange" : "badge-neutral"}>{aTraiter}</span>
          </button>
        </div>
      )}
      <select aria-label="Filtrer par véhicule"
        className="input !w-auto"
        value={searchParams.get("vehicle") ?? ""}
        onChange={(e) => setParam("vehicle", e.target.value)}
      >
        <option value="">Tous les véhicules</option>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
      {drivers && (
        <select aria-label="Filtrer par chauffeur"
          className="input !w-auto"
          value={searchParams.get("driver") ?? ""}
          onChange={(e) => setParam("driver", e.target.value)}
        >
          <option value="">Tous les chauffeurs</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-1.5 text-sm text-navy/70">
        Du
        <input type="date" aria-label="Depuis le" className="input !w-auto" value={searchParams.get("from") ?? ""} onChange={(e) => setParam("from", e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-navy/70">
        au
        <input type="date" aria-label="Jusqu'au" className="input !w-auto" value={searchParams.get("to") ?? ""} onChange={(e) => setParam("to", e.target.value)} />
      </label>
      {(searchParams.get("vehicle") || searchParams.get("driver") || searchParams.get("from") || searchParams.get("to") || searchParams.get("page") || searchParams.get("plein") || searchParams.get("a_traiter")) && (
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => router.push("/carburant/pleins")}>
          Réinitialiser
        </button>
      )}
    </div>
  );
}
