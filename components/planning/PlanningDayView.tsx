"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import { addDays } from "@/lib/planning/dates";
import { IconAlertTriangle, IconPencil } from "@/components/layout/icons";

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
  vehicles: { registration: string } | null;
  users: { full_name: string } | null;
}

const STATUS_BADGE: Record<string, string> = { planned: "badge-neutral", in_progress: "badge-gold", done: "badge-teal" };
const STATUS_LABEL: Record<string, string> = { planned: "Prévue", in_progress: "En cours", done: "Terminée" };

/** Single-day agenda, grouped by service — "what's happening today", with the same inline-edit (✎) as the other views. */
export function PlanningDayView({
  filteredServices,
  vehicles,
  drivers,
  entries,
  day,
  selectedService,
}: {
  services: ServiceOption[];
  filteredServices: ServiceOption[];
  vehicles: VehicleOption[];
  drivers: DriverOption[];
  entries: PlanningEntry[];
  day: string;
  selectedService: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTourNumber, setEditTourNumber] = useState("");
  const [editDriverId, setEditDriverId] = useState("");
  const [editVehicleId, setEditVehicleId] = useState("");
  const [editTime, setEditTime] = useState("07:00");

  function navTo(nextDay: string) {
    const qs = new URLSearchParams({ view: "day", day: nextDay });
    if (selectedService) qs.set("service", selectedService);
    router.push(`/exploitation/planning?${qs.toString()}`);
  }

  function startEdit(entry: PlanningEntry) {
    setEditingId(entry.id);
    setEditTourNumber(entry.tour_number);
    setEditDriverId(entry.driver_id ?? "");
    setEditVehicleId(entry.vehicle_id ?? "");
    setEditTime(new Date(entry.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false }));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(entry: PlanningEntry) {
    if (!editTourNumber || !editDriverId || !editVehicleId || !editTime) return;
    const start = new Date(`${day}T${editTime}:00`);
    setBusyId(entry.id);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/planning/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tour_number: editTourNumber,
          driver_id: editDriverId,
          vehicle_id: editVehicleId,
          start_at: start.toISOString(),
        }),
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

  const sorted = [...entries].sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(day, -1))}>
          ← Jour préc.
        </button>
        <span className="text-sm text-navy/70">{new Date(`${day}T00:00:00`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" })}</span>
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(day, 1))}>
          Jour suiv. →
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {warning && <p className="text-sm text-gold-ink"><IconAlertTriangle className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> {warning}</p>}

      {sorted.length === 0 ? (
        <EmptyState title="Aucune tournée ce jour-là" />
      ) : (
        <div className="flex flex-col gap-2">
          {filteredServices.map((service) => {
            const serviceEntries = sorted.filter((e) => e.service_id === service.id);
            if (serviceEntries.length === 0) return null;
            return (
              <Card key={service.id} className="flex flex-col gap-2">
                <p className="text-sm font-medium">{service.name}</p>
                <div className="flex flex-col gap-1.5">
                  {serviceEntries.map((e) =>
                    editingId === e.id ? (
                      <div key={e.id} className="flex flex-col gap-1 rounded-lg bg-navy/[0.04] p-2 sm:flex-row sm:items-center sm:flex-wrap">
                        <input
                          className="input !w-auto !py-1"
                          value={editTourNumber}
                          onChange={(ev) => setEditTourNumber(ev.target.value)}
                          aria-label="N° tournée" placeholder="N° tournée"
                        />
                        <select aria-label="Chauffeur" className="input !w-auto !py-1" value={editDriverId} onChange={(ev) => setEditDriverId(ev.target.value)}>
                          <option value="">Chauffeur…</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.full_name}
                            </option>
                          ))}
                        </select>
                        <select aria-label="Véhicule" className="input !w-auto !py-1" value={editVehicleId} onChange={(ev) => setEditVehicleId(ev.target.value)}>
                          <option value="">Véhicule…</option>
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.registration}
                            </option>
                          ))}
                        </select>
                        <input aria-label="Heure" className="input !w-auto !py-1" type="time" value={editTime} onChange={(ev) => setEditTime(ev.target.value)} />
                        <div className="flex gap-1">
                          <button className="btn-primary !px-2 !py-1 text-xs" disabled={busyId === e.id} onClick={() => saveEdit(e)}>
                            OK
                          </button>
                          <button className="btn-secondary !px-2 !py-1 text-xs" onClick={cancelEdit}>
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={e.id} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5 text-sm">
                        <span>
                          {new Date(e.start_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })} · n°{e.tour_number} ·{" "}
                          {e.users?.full_name ?? "—"} · {e.vehicles?.registration ?? "—"}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className={STATUS_BADGE[e.status] ?? "badge-neutral"}>{STATUS_LABEL[e.status] ?? e.status}</span>
                          {e.status === "planned" && (
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
                    ),
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Link href={`/exploitation/planning?view=week${selectedService ? `&service=${selectedService}` : ""}`} className="text-sm text-teal-ink hover:underline">
        Passer en vue semaine pour glisser-déposer une affectation →
      </Link>
    </div>
  );
}
