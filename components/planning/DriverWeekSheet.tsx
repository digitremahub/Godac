"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ServiceOption {
  id: string;
  name: string;
}
interface VehicleOption {
  id: string;
  registration: string;
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

const DAY_LABELS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const STATUS_LABEL: Record<string, string> = { planned: "Prévue", in_progress: "En cours", done: "Terminée" };

/**
 * "Fiche chauffeur" — opened by clicking a driver's name anywhere in
 * planning. Two ways to fill a week for one driver: the bulk form at
 * top (same service/vehicle/tournée/heure every checked day — the
 * fast default path, same endpoint as "Toute la semaine" in the
 * creation form) and, below it, that driver's actual entries for the
 * week, each editable/deletable one at a time for the cases that need
 * an exception. Always reads its `entries` straight from the parent
 * view's own props (never a separate fetch or local copy), so it's
 * automatically in sync with the general planning the moment either
 * changes and the page refreshes.
 */
export function DriverWeekSheet({
  driver,
  weekStart,
  services,
  vehicles,
  entries,
  onClose,
}: {
  driver: { id: string; full_name: string };
  weekStart: string;
  services: ServiceOption[];
  vehicles: VehicleOption[];
  entries: PlanningEntry[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [bulkService, setBulkService] = useState(services[0]?.id ?? "");
  const [bulkVehicle, setBulkVehicle] = useState("");
  const [bulkTour, setBulkTour] = useState("");
  const [bulkTime, setBulkTime] = useState("07:00");
  const [bulkDays, setBulkDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTour, setEditTour] = useState("");
  const [editService, setEditService] = useState("");
  const [editVehicle, setEditVehicle] = useState("");
  const [editTime, setEditTime] = useState("07:00");
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const driverEntries = entries.filter((e) => e.driver_id === driver.id).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const serviceNameById = new Map(services.map((s) => [s.id, s.name]));
  const vehicleRegById = new Map(vehicles.map((v) => [v.id, v.registration]));

  function toggleBulkDay(i: number) {
    setBulkDays((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function submitBulk() {
    if (!bulkService || !bulkVehicle || !bulkTour || !bulkTime || bulkDays.size === 0) return;
    setBusy(true);
    setError(null);
    setBulkSummary(null);
    try {
      const res = await fetch("/api/planning/entries/bulk-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: bulkService,
          driver_id: driver.id,
          vehicle_id: bulkVehicle,
          tour_number: bulkTour,
          week_start: weekStart,
          time: bulkTime,
          days: Array.from(bulkDays),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setBulkSummary(
        json.created > 0
          ? `${json.created} jour(s) affecté(s)${json.skipped > 0 ? ` (${json.skipped} déjà occupé(s), ignoré(s))` : ""}.`
          : "Rien à créer (tous les jours sélectionnés ont déjà une affectation).",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(entry: PlanningEntry) {
    setEditingId(entry.id);
    setEditTour(entry.tour_number);
    setEditService(entry.service_id);
    setEditVehicle(entry.vehicle_id ?? "");
    setEditTime(new Date(entry.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false }));
  }

  async function saveEdit(entry: PlanningEntry) {
    if (!editTour || !editService || !editVehicle || !editTime) return;
    const day = entry.start_at.slice(0, 10);
    const start = new Date(`${day}T${editTime}:00`);
    setRowBusyId(entry.id);
    setError(null);
    try {
      const res = await fetch(`/api/planning/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tour_number: editTour, service_id: editService, vehicle_id: editVehicle, start_at: start.toISOString() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setRowBusyId(null);
    }
  }

  async function removeEntry(id: string) {
    setRowBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/planning/entries/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setRowBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="font-display text-lg font-bold">{driver.full_name}</p>
            <p className="text-xs text-navy/40">Semaine du {weekStart.split("-").reverse().join("/")}</p>
          </div>
          <button className="text-xl text-navy/40 hover:text-navy" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-orange-ink">{error}</p>}

        <div className="mb-4 flex flex-col gap-2 rounded-lg bg-navy/5 p-3">
          <p className="text-sm font-medium">Affecter toute la semaine</p>
          <div className="flex flex-wrap gap-2">
            <select className="input !w-auto" value={bulkService} onChange={(e) => setBulkService(e.target.value)}>
              <option value="">Service…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className="input !w-auto" value={bulkVehicle} onChange={(e) => setBulkVehicle(e.target.value)}>
              <option value="">Véhicule…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registration}
                </option>
              ))}
            </select>
            <input
              className="input !w-auto"
              value={bulkTour}
              onChange={(e) => setBulkTour(e.target.value)}
              placeholder="N° tournée"
            />
            <input className="input !w-auto" type="time" value={bulkTime} onChange={(e) => setBulkTime(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {DAY_LABELS.map((label, i) => (
              <button
                key={i}
                type="button"
                className={`rounded-md px-2 py-1 text-xs ${bulkDays.has(i) ? "bg-teal/20 text-teal-ink" : "bg-white text-navy/40"}`}
                onClick={() => toggleBulkDay(i)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="btn-primary w-full"
            disabled={busy || !bulkService || !bulkVehicle || !bulkTour || bulkDays.size === 0}
            onClick={submitBulk}
          >
            {busy ? "Envoi…" : "Affecter"}
          </button>
          {bulkSummary && <p className="text-xs text-teal-ink">{bulkSummary}</p>}
        </div>

        <p className="mb-2 text-sm font-medium">Cette semaine</p>
        {driverEntries.length === 0 ? (
          <p className="text-xs text-navy/40">Rien cette semaine pour l&apos;instant.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {driverEntries.map((entry) =>
              editingId === entry.id ? (
                <div key={entry.id} className="flex flex-col gap-1.5 rounded-lg bg-navy/5 p-2">
                  <div className="flex flex-wrap gap-1.5">
                    <input
                      className="input !w-auto !py-1 text-sm"
                      value={editTour}
                      onChange={(e) => setEditTour(e.target.value)}
                      placeholder="N° tournée"
                    />
                    <select className="input !w-auto !py-1 text-sm" value={editService} onChange={(e) => setEditService(e.target.value)}>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <select className="input !w-auto !py-1 text-sm" value={editVehicle} onChange={(e) => setEditVehicle(e.target.value)}>
                      <option value="">Véhicule…</option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.registration}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input !w-auto !py-1 text-sm"
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <button className="btn-primary !py-1 text-xs" disabled={rowBusyId === entry.id} onClick={() => saveEdit(entry)}>
                      OK
                    </button>
                    <button className="btn-secondary !py-1 text-xs" onClick={() => setEditingId(null)}>
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between rounded-lg bg-navy/5 px-3 py-2 text-sm ${rowBusyId === entry.id ? "opacity-40" : ""}`}
                >
                  <span>
                    {new Date(entry.start_at).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}{" "}
                    {new Date(entry.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · n°{entry.tour_number} ·{" "}
                    {serviceNameById.get(entry.service_id) ?? "—"} · {vehicleRegById.get(entry.vehicle_id ?? "") ?? "—"}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="badge-neutral">{STATUS_LABEL[entry.status] ?? entry.status}</span>
                    {entry.status === "planned" && (
                      <>
                        <button className="text-navy/30 hover:text-teal-ink" onClick={() => startEdit(entry)} aria-label="Modifier">
                          ✎
                        </button>
                        <button className="text-navy/30 hover:text-orange-ink" onClick={() => removeEntry(entry.id)} aria-label="Supprimer">
                          ×
                        </button>
                      </>
                    )}
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
