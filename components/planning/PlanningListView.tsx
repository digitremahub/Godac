"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { addDays } from "@/lib/planning/dates";
import { DriverWeekSheet } from "@/components/planning/DriverWeekSheet";

interface ServiceOption {
  id: string;
  name: string;
}
interface VehicleOption {
  id: string;
  registration: string;
}
interface DriverOption {
  id: string;
  full_name: string;
}
interface PlanningEntry {
  id: string;
  service_id: string;
  tour_number: string;
  driver_id: string | null;
  vehicle_id: string | null;
  start_at: string;
  status: string;
}

const STATUS_LABEL: Record<string, string> = { planned: "Prévue", in_progress: "En cours", done: "Terminée" };

/**
 * The "easier to manage" alternative to the week grid and the kanban
 * board: a plain table, no drag required — reassign a driver/vehicle
 * with a dropdown, which is both faster to scan on a phone and more
 * forgiving than drag-and-drop for a quick edit.
 */
export function PlanningListView({
  services,
  vehicles,
  drivers,
  entries,
  weekStart,
  selectedService,
}: {
  services: ServiceOption[];
  vehicles: VehicleOption[];
  drivers: DriverOption[];
  entries: PlanningEntry[];
  weekStart: string;
  selectedService: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [openDriverSheet, setOpenDriverSheet] = useState<{ id: string; full_name: string } | null>(null);

  function navTo(nextWeekStart: string) {
    const qs = new URLSearchParams({ view: "list", week: nextWeekStart });
    if (selectedService) qs.set("service", selectedService);
    router.push(`/planning?${qs.toString()}`);
  }

  function toDatetimeLocal(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function patch(entryId: string, fields: Record<string, string>) {
    setBusyId(entryId);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/planning/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      if (json.warning) setWarning(json.warning);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  const serviceNameById = new Map(services.map((s) => [s.id, s.name]));
  const sorted = [...entries].sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(weekStart, -7))}>
          ← Semaine préc.
        </button>
        <span className="text-sm text-navy/60">Semaine du {weekStart.split("-").reverse().join("/")}</span>
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(weekStart, 7))}>
          Semaine suiv. →
        </button>
      </div>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {warning && <p className="text-sm text-gold-ink">⚠️ {warning}</p>}

      {sorted.length === 0 ? (
        <EmptyState title="Aucune affectation cette semaine" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-navy/40">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Service</th>
                <th className="pb-2">Tournée</th>
                <th className="pb-2">Chauffeur</th>
                <th className="pb-2">Véhicule</th>
                <th className="pb-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className={`border-t border-navy/5 ${busyId === e.id ? "opacity-40" : ""}`}>
                  <td className="py-2">
                    {e.status === "planned" ? (
                      <input
                        key={e.id}
                        className="input !w-auto !py-1"
                        type="datetime-local"
                        defaultValue={toDatetimeLocal(e.start_at)}
                        disabled={busyId === e.id}
                        onBlur={(ev) => {
                          const next = ev.target.value;
                          if (!next) return;
                          const iso = new Date(next).toISOString();
                          if (iso !== e.start_at) patch(e.id, { start_at: iso });
                        }}
                      />
                    ) : (
                      <>
                        {new Date(e.start_at).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}{" "}
                        {new Date(e.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </>
                    )}
                  </td>
                  <td className="py-2">{serviceNameById.get(e.service_id) ?? "—"}</td>
                  <td className="py-2">
                    {e.status === "planned" ? (
                      <input
                        key={e.id}
                        className="input !w-auto !py-1"
                        defaultValue={e.tour_number}
                        disabled={busyId === e.id}
                        onBlur={(ev) => {
                          const next = ev.target.value.trim();
                          if (next && next !== e.tour_number) patch(e.id, { tour_number: next });
                        }}
                      />
                    ) : (
                      `n°${e.tour_number}`
                    )}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      {e.status === "planned" ? (
                        <select
                          className="input !w-auto !py-1"
                          value={e.driver_id ?? ""}
                          disabled={busyId === e.id}
                          onChange={(ev) => patch(e.id, { driver_id: ev.target.value })}
                        >
                          <option value="">—</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.full_name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        (drivers.find((d) => d.id === e.driver_id)?.full_name ?? "—")
                      )}
                      {e.driver_id && (
                        <button
                          type="button"
                          className="text-navy/30 hover:text-teal-ink"
                          title="Fiche chauffeur"
                          aria-label="Fiche chauffeur"
                          onClick={() => {
                            const d = drivers.find((d) => d.id === e.driver_id);
                            if (d) setOpenDriverSheet(d);
                          }}
                        >
                          👤
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2">
                    {e.status === "planned" ? (
                      <select
                        className="input !w-auto !py-1"
                        value={e.vehicle_id ?? ""}
                        disabled={busyId === e.id}
                        onChange={(ev) => patch(e.id, { vehicle_id: ev.target.value })}
                      >
                        <option value="">—</option>
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.registration}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (vehicles.find((v) => v.id === e.vehicle_id)?.registration ?? "—")
                    )}
                  </td>
                  <td className="py-2">{STATUS_LABEL[e.status] ?? e.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {openDriverSheet && (
        <DriverWeekSheet
          driver={openDriverSheet}
          weekStart={weekStart}
          services={services}
          vehicles={vehicles}
          entries={entries}
          onClose={() => setOpenDriverSheet(null)}
        />
      )}
    </div>
  );
}
