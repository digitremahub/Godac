"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addDays } from "@/lib/planning/dates";
import { DriverWeekSheet } from "@/components/planning/DriverWeekSheet";

interface ServiceOption {
  id: string;
  name: string;
}
interface DriverOption {
  id: string;
  full_name: string;
}
interface VehicleOption {
  id: string;
  registration: string;
}
interface PlanningEntry {
  id: string;
  service_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  tour_number: string;
  start_at: string;
  status: string;
  vehicles: { registration: string } | null;
}

const STATUS_BADGE: Record<string, string> = { planned: "badge-neutral", in_progress: "badge-gold", done: "badge-teal" };
const STATUS_LABEL: Record<string, string> = { planned: "Prévue", in_progress: "En cours", done: "Terminée" };

/**
 * Driver-centric board for the current week: one column per chauffeur,
 * cards sorted by date. Dragging a card into another driver's column
 * reassigns it — a different axis of editing than the week grid's
 * "move to another day" drag, useful when the question is "who's
 * free to cover this" rather than "which day". Each card also has the
 * same inline-edit (✎) capability as the week grid, for tour
 * number/vehicle/time without needing to drag.
 */
export function PlanningKanbanView({
  services,
  drivers,
  vehicles,
  entries,
  weekStart,
  selectedService,
}: {
  services: ServiceOption[];
  drivers: DriverOption[];
  vehicles: VehicleOption[];
  entries: PlanningEntry[];
  weekStart: string;
  selectedService: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [openDriverSheet, setOpenDriverSheet] = useState<{ id: string; full_name: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTourNumber, setEditTourNumber] = useState("");
  const [editVehicleId, setEditVehicleId] = useState("");
  const [editTime, setEditTime] = useState("07:00");

  function navTo(nextWeekStart: string) {
    const qs = new URLSearchParams({ view: "kanban", week: nextWeekStart });
    if (selectedService) qs.set("service", selectedService);
    router.push(`/planning?${qs.toString()}`);
  }

  async function reassign(entryId: string, driverId: string) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry || entry.status !== "planned" || entry.driver_id === driverId) return;
    setBusyId(entryId);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/planning/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driver_id: driverId }),
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

  function startEdit(entry: PlanningEntry) {
    setEditingId(entry.id);
    setEditTourNumber(entry.tour_number);
    setEditVehicleId(entry.vehicle_id ?? "");
    setEditTime(new Date(entry.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false }));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(entry: PlanningEntry) {
    if (!editTourNumber || !editVehicleId || !editTime) return;
    const day = entry.start_at.slice(0, 10);
    const start = new Date(`${day}T${editTime}:00`);
    setBusyId(entry.id);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/planning/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tour_number: editTourNumber, vehicle_id: editVehicleId, start_at: start.toISOString() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      if (json.warning) setWarning(json.warning);
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  async function removeEntry(entryId: string) {
    setBusyId(entryId);
    setError(null);
    try {
      const res = await fetch(`/api/planning/entries/${entryId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusyId(null);
    }
  }

  const driversWithEntries = drivers.filter((d) => entries.some((e) => e.driver_id === d.id));
  const columns = driversWithEntries.length > 0 ? driversWithEntries : drivers;

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

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((driver) => {
          const driverEntries = entries.filter((e) => e.driver_id === driver.id).sort((a, b) => a.start_at.localeCompare(b.start_at));
          return (
            <div
              key={driver.id}
              className="min-w-[220px] shrink-0 rounded-xl bg-navy/5 p-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const entryId = e.dataTransfer.getData("text/plain");
                if (entryId) reassign(entryId, driver.id);
              }}
            >
              <p className="mb-2 px-1 text-sm font-medium">
                <button type="button" className="hover:underline" onClick={() => setOpenDriverSheet(driver)}>
                  {driver.full_name}
                </button>{" "}
                <span className="text-xs text-navy/40">({driverEntries.length})</span>
              </p>
              <div className="flex flex-col gap-1.5">
                {driverEntries.map((e) => (
                  <div
                    key={e.id}
                    draggable={e.status === "planned" && editingId !== e.id}
                    onDragStart={(ev) => ev.dataTransfer.setData("text/plain", e.id)}
                    className={`rounded-lg bg-white p-2 text-xs shadow-sm ${e.status === "planned" ? "cursor-move" : "opacity-80"} ${
                      busyId === e.id ? "opacity-40" : ""
                    }`}
                  >
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className="font-medium">n°{e.tour_number}</span>
                      <span className="flex items-center gap-1">
                        <span className={STATUS_BADGE[e.status] ?? "badge-neutral"}>{STATUS_LABEL[e.status] ?? e.status}</span>
                        {e.status === "planned" && editingId !== e.id && (
                          <>
                            <button className="text-navy/30 hover:text-teal-ink" onClick={() => startEdit(e)} aria-label="Modifier" title="Modifier">
                              ✎
                            </button>
                            <button className="text-navy/30 hover:text-orange-ink" onClick={() => removeEntry(e.id)} aria-label="Supprimer" title="Supprimer">
                              ×
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                    {editingId === e.id ? (
                      <div className="flex flex-col gap-1">
                        <input
                          className="input !h-7 !py-0.5 !text-xs"
                          value={editTourNumber}
                          onChange={(ev) => setEditTourNumber(ev.target.value)}
                          placeholder="N° tournée"
                        />
                        <select className="input !h-7 !py-0.5 !text-xs" value={editVehicleId} onChange={(ev) => setEditVehicleId(ev.target.value)}>
                          <option value="">Véhicule…</option>
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.registration}
                            </option>
                          ))}
                        </select>
                        <input
                          className="input !h-7 !py-0.5 !text-xs"
                          type="time"
                          value={editTime}
                          onChange={(ev) => setEditTime(ev.target.value)}
                        />
                        <div className="flex gap-1">
                          <button className="btn-primary !h-6 flex-1 !px-1 !py-0 !text-[11px]" onClick={() => saveEdit(e)}>
                            OK
                          </button>
                          <button className="btn-secondary !h-6 flex-1 !px-1 !py-0 !text-[11px]" onClick={cancelEdit}>
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-navy/50">
                          {new Date(e.start_at).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ·{" "}
                          {new Date(e.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                        <p className="text-navy/40">{e.vehicles?.registration ?? "—"}</p>
                      </>
                    )}
                  </div>
                ))}
                {driverEntries.length === 0 && <p className="px-1 text-xs text-navy/30">Rien cette semaine</p>}
              </div>
            </div>
          );
        })}
      </div>

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
