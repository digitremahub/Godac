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
}: {
  vehicles: Option[];
  drivers: Option[] | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

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
      {(searchParams.get("vehicle") || searchParams.get("driver") || searchParams.get("from") || searchParams.get("to") || searchParams.get("page") || searchParams.get("plein")) && (
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => router.push("/carburant/pleins")}>
          Réinitialiser
        </button>
      )}
    </div>
  );
}
