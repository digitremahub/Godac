"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addDays } from "@/lib/planning/dates";
import { DriverWeekSheet } from "@/components/planning/DriverWeekSheet";
import { IconAlertTriangle, IconPencil } from "@/components/layout/icons";

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
 *
 * A second "Par service" mode turns the axis around: columns become
 * services, cards become individual *tours* (planning_entries) staffed
 * by polyvalent drivers (qualified on 2+ services via user_services —
 * titulaires, with nowhere else to go, stay out of this board). A
 * polyvalent driver can legitimately work different services on
 * different days of the same week, so the drag unit here is the tour,
 * not the driver — dragging one tour's card into another service
 * column reassigns just that tour's service_id, same as the week
 * grid's day-to-day drag reassigns a day. It never touches the
 * driver's standing qualifications (those are edited from their fiche).
 */
export function PlanningKanbanView({
  services,
  drivers,
  vehicles,
  entries,
  weekStart,
  selectedService,
  driverServiceIds = {},
}: {
  services: ServiceOption[];
  drivers: DriverOption[];
  vehicles: VehicleOption[];
  entries: PlanningEntry[];
  weekStart: string;
  selectedService: string;
  driverServiceIds?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"driver" | "service">("driver");
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
    router.push(`/exploitation/planning?${qs.toString()}`);
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

  async function reassignEntryService(entryId: string, targetServiceId: string) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry || entry.status !== "planned" || entry.service_id === targetServiceId) return;
    setBusyId(entryId);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/planning/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: targetServiceId }),
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
    setEditTime(new Date(entry.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false }));
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
    if (!window.confirm("Supprimer cette tournée du planning ?")) return;
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

  const serviceNameById = new Map(services.map((s) => [s.id, s.name]));
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const polyvalentDriverIds = new Set(drivers.filter((d) => (driverServiceIds[d.id]?.length ?? 0) >= 2).map((d) => d.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(weekStart, -7))}>
          ← Semaine préc.
        </button>
        <span className="text-sm text-navy/70">Semaine du {weekStart.split("-").reverse().join("/")}</span>
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(weekStart, 7))}>
          Semaine suiv. →
        </button>
        <span className="ml-2 flex overflow-hidden rounded-lg border border-navy/10 text-sm">
          <button
            className={`!rounded-none !border-0 !px-3 !py-1.5 ${mode === "driver" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setMode("driver")}
          >
            Par chauffeur
          </button>
          <button
            className={`!rounded-none !border-0 !px-3 !py-1.5 ${mode === "service" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setMode("service")}
          >
            Par service
          </button>
        </span>
      </div>
      {mode === "service" && (
        <p className="text-xs text-navy/65">
          Glissez la tournée d&apos;un chauffeur polyvalent vers un autre service pour la réaffecter (un polyvalent peut travailler sur
          plusieurs services différents jours de la semaine).
        </p>
      )}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {warning && <p className="text-sm text-gold-ink"><IconAlertTriangle className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> {warning}</p>}

      {mode === "driver" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((driver) => {
            const driverEntries = entries.filter((e) => e.driver_id === driver.id).sort((a, b) => a.start_at.localeCompare(b.start_at));
            return (
              <div
                key={driver.id}
                className="min-w-[220px] shrink-0 rounded-xl bg-navy/[0.04] p-2"
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
                  <span className="text-xs text-navy/60">({driverEntries.length})</span>
                </p>
                <div className="flex flex-col gap-1.5">
                  {driverEntries.map((e) => (
                    <div
                      key={e.id}
                      draggable={e.status === "planned" && editingId !== e.id}
                      onDragStart={(ev) => ev.dataTransfer.setData("text/plain", e.id)}
                      className={`rounded-lg bg-surface p-2 text-xs shadow-sm ${e.status === "planned" ? "cursor-move" : "opacity-80"} ${
                        busyId === e.id ? "opacity-40" : ""
                      }`}
                    >
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="font-medium">n°{e.tour_number}</span>
                        <span className="flex items-center gap-1">
                          <span className={STATUS_BADGE[e.status] ?? "badge-neutral"}>{STATUS_LABEL[e.status] ?? e.status}</span>
                          {e.status === "planned" && editingId !== e.id && (
                            <>
                              <button className="text-navy/60 hover:text-teal-ink" onClick={() => startEdit(e)} aria-label="Modifier" title="Modifier">
                                <IconPencil className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" />
                              </button>
                              <button className="text-navy/60 hover:text-orange-ink" onClick={() => removeEntry(e.id)} aria-label="Supprimer" title="Supprimer">
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
                            aria-label="N° tournée" placeholder="N° tournée"
                          />
                          <select aria-label="Véhicule" className="input !h-7 !py-0.5 !text-xs" value={editVehicleId} onChange={(ev) => setEditVehicleId(ev.target.value)}>
                            <option value="">Véhicule…</option>
                            {vehicles.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.registration}
                              </option>
                            ))}
                          </select>
                          <input aria-label="Heure"
                            className="input !h-7 !py-0.5 !text-xs"
                            type="time"
                            value={editTime}
                            onChange={(ev) => setEditTime(ev.target.value)}
                          />
                          <div className="flex gap-1">
                            <button className="btn-primary !h-6 flex-1 !px-1 !py-0 !text-xs" onClick={() => saveEdit(e)}>
                              OK
                            </button>
                            <button className="btn-secondary !h-6 flex-1 !px-1 !py-0 !text-xs" onClick={cancelEdit}>
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-navy/65">
                            {new Date(e.start_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric" })} ·{" "}
                            {new Date(e.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}
                          </p>
                          <p className="text-navy/60">{e.vehicles?.registration ?? "—"}</p>
                        </>
                      )}
                    </div>
                  ))}
                  {driverEntries.length === 0 && <p className="px-1 text-xs text-navy/60">Rien cette semaine</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {services.map((service) => {
            const serviceEntries = entries
              .filter((e) => e.service_id === service.id && e.driver_id && polyvalentDriverIds.has(e.driver_id))
              .sort((a, b) => a.start_at.localeCompare(b.start_at));
            return (
              <div
                key={service.id}
                className="min-w-[240px] shrink-0 rounded-xl bg-navy/[0.04] p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const entryId = e.dataTransfer.getData("text/plain");
                  const entry = entries.find((x) => x.id === entryId);
                  if (!entry || !entry.driver_id) return;
                  if (!(driverServiceIds[entry.driver_id] ?? []).includes(service.id)) {
                    setError("Ce chauffeur n'est pas qualifié sur ce service (voir sa fiche).");
                    return;
                  }
                  reassignEntryService(entryId, service.id);
                }}
              >
                <p className="mb-2 px-1 text-sm font-medium">
                  {service.name} <span className="text-xs text-navy/60">({serviceEntries.length})</span>
                </p>
                <div className="flex flex-col gap-1.5">
                  {serviceEntries.map((e) => {
                    const driver = e.driver_id ? driverById.get(e.driver_id) : undefined;
                    const otherServices = (driverServiceIds[e.driver_id ?? ""] ?? [])
                      .filter((id) => id !== service.id)
                      .map((id) => serviceNameById.get(id))
                      .filter(Boolean);
                    return (
                      <div
                        key={e.id}
                        draggable={e.status === "planned" && busyId !== e.id}
                        onDragStart={(ev) => ev.dataTransfer.setData("text/plain", e.id)}
                        className={`rounded-lg bg-surface p-2 text-xs shadow-sm ${e.status === "planned" ? "cursor-move" : "opacity-80"} ${
                          busyId === e.id ? "opacity-40" : ""
                        }`}
                      >
                        <div className="mb-0.5 flex items-center justify-between">
                          {driver ? (
                            <button type="button" className="font-medium hover:underline" onClick={() => setOpenDriverSheet(driver)}>
                              {driver.full_name}
                            </button>
                          ) : (
                            <span className="font-medium">—</span>
                          )}
                          <span className="badge-gold">Polyvalent</span>
                        </div>
                        <p className="text-navy/65">
                          n°{e.tour_number} ·{" "}
                          {new Date(e.start_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric" })}{" "}
                          {new Date(e.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}
                        </p>
                        {otherServices.length > 0 && <p className="text-navy/60">Aussi qualifié : {otherServices.join(", ")}</p>}
                      </div>
                    );
                  })}
                  {serviceEntries.length === 0 && <p className="px-1 text-xs text-navy/60">Aucune tournée polyvalente ici cette semaine</p>}
                </div>
              </div>
            );
          })}
        </div>
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
