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
const DRIVER_DRAG_PREFIX = "driver:";

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
 * services, cards become polyvalent drivers (qualified on 2+
 * services via user_services — the only ones a service move makes
 * sense for; titulaires stay out of this board entirely). Dragging
 * one into another service column bulk-moves all of their *planned*
 * entries for the displayed week to that service — a weekly
 * rebalancing tool, it never touches their standing qualifications
 * (those are edited from the driver's own fiche).
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

  async function reassignDriverService(driverId: string, targetServiceId: string) {
    const driverEntries = entries.filter((e) => e.driver_id === driverId && e.status === "planned" && e.service_id !== targetServiceId);
    if (driverEntries.length === 0) return;
    setBusyId(driverId);
    setError(null);
    setWarning(null);
    try {
      const results = await Promise.all(
        driverEntries.map((e) =>
          fetch(`/api/planning/entries/${e.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ service_id: targetServiceId }),
          }).then(async (res) => ({ ok: res.ok, json: await res.json() })),
        ),
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(
          failed.length === driverEntries.length
            ? "Aucune tournée n'a pu être déplacée vers ce service (conflit avec une tournée existante)."
            : `${failed.length} tournée(s) sur ${driverEntries.length} n'ont pas pu être déplacées (conflit avec une tournée existante).`,
        );
      }
      const firstWarning = results.map((r) => r.json?.warning).find(Boolean);
      if (firstWarning) setWarning(firstWarning);
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

  const serviceNameById = new Map(services.map((s) => [s.id, s.name]));
  const polyvalentDrivers = drivers.filter((d) => (driverServiceIds[d.id]?.length ?? 0) >= 2);
  const polyvalentEntriesByDriver = new Map<string, PlanningEntry[]>();
  for (const d of polyvalentDrivers) {
    const list = entries.filter((e) => e.driver_id === d.id).sort((a, b) => a.start_at.localeCompare(b.start_at));
    if (list.length > 0) polyvalentEntriesByDriver.set(d.id, list);
  }

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
        <p className="text-xs text-navy/50">
          Glissez un chauffeur polyvalent vers un autre service pour y déplacer toutes ses tournées prévues cette semaine.
        </p>
      )}
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {warning && <p className="text-sm text-gold-ink">⚠️ {warning}</p>}

      {mode === "driver" ? (
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
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {services.map((service) => {
            const serviceDrivers = polyvalentDrivers.filter((d) => {
              const driverEntries = polyvalentEntriesByDriver.get(d.id);
              return driverEntries && driverEntries[0]?.service_id === service.id;
            });
            return (
              <div
                key={service.id}
                className="min-w-[240px] shrink-0 rounded-xl bg-navy/5 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const payload = e.dataTransfer.getData("text/plain");
                  if (!payload.startsWith(DRIVER_DRAG_PREFIX)) return;
                  const driverId = payload.slice(DRIVER_DRAG_PREFIX.length);
                  if (!(driverServiceIds[driverId] ?? []).includes(service.id)) {
                    setError("Ce chauffeur n'est pas qualifié sur ce service (voir sa fiche).");
                    return;
                  }
                  reassignDriverService(driverId, service.id);
                }}
              >
                <p className="mb-2 px-1 text-sm font-medium">
                  {service.name} <span className="text-xs text-navy/40">({serviceDrivers.length})</span>
                </p>
                <div className="flex flex-col gap-1.5">
                  {serviceDrivers.map((driver) => {
                    const driverEntries = polyvalentEntriesByDriver.get(driver.id) ?? [];
                    const otherServices = (driverServiceIds[driver.id] ?? [])
                      .filter((id) => id !== service.id)
                      .map((id) => serviceNameById.get(id))
                      .filter(Boolean);
                    return (
                      <div
                        key={driver.id}
                        draggable={busyId !== driver.id}
                        onDragStart={(ev) => ev.dataTransfer.setData("text/plain", `${DRIVER_DRAG_PREFIX}${driver.id}`)}
                        className={`cursor-move rounded-lg bg-white p-2 text-xs shadow-sm ${busyId === driver.id ? "opacity-40" : ""}`}
                      >
                        <div className="mb-0.5 flex items-center justify-between">
                          <button type="button" className="font-medium hover:underline" onClick={() => setOpenDriverSheet(driver)}>
                            {driver.full_name}
                          </button>
                          <span className="badge-gold">Polyvalent</span>
                        </div>
                        <p className="text-navy/50">
                          {driverEntries.length} tournée{driverEntries.length > 1 ? "s" : ""} cette semaine
                        </p>
                        {otherServices.length > 0 && <p className="text-navy/40">Aussi qualifié : {otherServices.join(", ")}</p>}
                      </div>
                    );
                  })}
                  {serviceDrivers.length === 0 && <p className="px-1 text-xs text-navy/30">Aucun chauffeur polyvalent ici cette semaine</p>}
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
