"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { addDays } from "@/lib/planning/dates";
import { DriverWeekSheet } from "@/components/planning/DriverWeekSheet";

interface ServiceOption {
  id: string;
  name: string;
}
interface VehicleOption {
  id: string;
  registration: string;
  service_id: string | null;
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
  users: { full_name: string; phone: string | null; email: string | null } | null;
}

/** Best-effort French-number normalization: wa.me needs a full international number, no leading 0. */
function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return digits.startsWith("0") && digits.length === 10 ? `33${digits.slice(1)}` : digits;
}

function buildShareText(entry: PlanningEntry): string {
  const date = new Date(entry.start_at);
  const lines = [
    `Tournée n°${entry.tour_number}`,
    entry.vehicles ? `Véhicule : ${entry.vehicles.registration}` : null,
    `Départ prévu : ${date.toLocaleDateString("fr-FR")} à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

const DAY_LABELS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const STATUS_BADGE: Record<string, string> = {
  planned: "badge-neutral",
  in_progress: "badge-gold",
  done: "badge-teal",
};
const STATUS_LABEL: Record<string, string> = {
  planned: "Prévue",
  in_progress: "En cours",
  done: "Terminée",
};

export function PlanningGrid({
  services,
  filteredServices,
  vehicles,
  drivers,
  entries,
  weekStart,
  prevWeek,
  nextWeek,
  selectedService,
  lastTourByDriver = {},
  canValidate = false,
  validatedByService = {},
}: {
  services: ServiceOption[];
  filteredServices: ServiceOption[];
  vehicles: VehicleOption[];
  drivers: DriverOption[];
  entries: PlanningEntry[];
  weekStart: string;
  prevWeek: string;
  nextWeek: string;
  selectedService: string;
  /** Each driver's most recent tour (any week) — pre-fills the form below so re-typing the same weekly route isn't needed every time. */
  lastTourByDriver?: Record<string, { vehicleId: string; tourNumber: string }>;
  /** Only manager/direction get "Valider et envoyer" — see app/api/planning/validate. */
  canValidate?: boolean;
  /** service_id -> ISO validated_at, for the service(s) already validated this week. */
  validatedByService?: Record<string, string>;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateSummary, setDuplicateSummary] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formService, setFormService] = useState(filteredServices[0]?.id ?? services[0]?.id ?? "");
  const [formDay, setFormDay] = useState(weekStart);
  const [formTime, setFormTime] = useState("07:00");
  const [formTourNumber, setFormTourNumber] = useState("");
  const [formDriverId, setFormDriverId] = useState("");
  const [formVehicleId, setFormVehicleId] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formWholeWeek, setFormWholeWeek] = useState(false);
  const [formDays, setFormDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [openDriverSheet, setOpenDriverSheet] = useState<{ id: string; full_name: string } | null>(null);
  const [duplicatingEntryId, setDuplicatingEntryId] = useState<string | null>(null);
  const [duplicateTargetDate, setDuplicateTargetDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTourNumber, setEditTourNumber] = useState("");
  const [editDriverId, setEditDriverId] = useState("");
  const [editVehicleId, setEditVehicleId] = useState("");
  const [editTime, setEditTime] = useState("07:00");

  function toggleFormDay(offset: number) {
    setFormDays((prev) => {
      const next = new Set(prev);
      if (next.has(offset)) next.delete(offset);
      else next.add(offset);
      return next;
    });
  }

  function selectDriver(driverId: string) {
    setFormDriverId(driverId);
    const last = lastTourByDriver[driverId];
    if (last) {
      if (!formVehicleId) setFormVehicleId(last.vehicleId);
      if (!formTourNumber) setFormTourNumber(last.tourNumber);
    }
  }

  async function duplicatePreviousWeek() {
    setDuplicating(true);
    setError(null);
    setWarning(null);
    setDuplicateSummary(null);
    try {
      const res = await fetch("/api/planning/duplicate-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_week_start: prevWeek,
          target_week_start: weekStart,
          service_id: selectedService || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      if (json.warning) setWarning(json.warning);
      setDuplicateSummary(
        json.created > 0
          ? `${json.created} affectation(s) copiée(s) depuis la semaine précédente.`
          : "Rien à copier (semaine précédente vide, ou déjà dupliquée).",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setDuplicating(false);
    }
  }

  async function validatePlanning() {
    if (!selectedService) return;
    setValidating(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/planning/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: selectedService, week_start: weekStart }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setValidating(false);
    }
  }

  const validatedAt = selectedService ? validatedByService[selectedService] : undefined;

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function navTo(week: string, service: string) {
    const qs = new URLSearchParams();
    qs.set("week", week);
    if (service) qs.set("service", service);
    router.push(`/planning?${qs.toString()}`);
  }

  async function moveEntry(entryId: string, targetServiceId: string, targetDay: string) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry || entry.status !== "planned") return;
    const original = new Date(entry.start_at);
    const target = new Date(`${targetDay}T00:00:00`);
    target.setHours(original.getHours(), original.getMinutes(), 0, 0);

    setBusyId(entryId);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/planning/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_at: target.toISOString(), service_id: targetServiceId }),
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

  function openDuplicatePicker(entry: PlanningEntry) {
    setDuplicatingEntryId(entry.id);
    setDuplicateTargetDate(addDays(entry.start_at.slice(0, 10), 7));
  }

  function cancelDuplicatePicker() {
    setDuplicatingEntryId(null);
  }

  async function confirmDuplicateEntry(entryId: string) {
    setBusyId(entryId);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch(`/api/planning/entries/${entryId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_date: duplicateTargetDate || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      if (json.warning) setWarning(json.warning);
      setDuplicatingEntryId(null);
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
    setEditDriverId(entry.driver_id ?? "");
    setEditVehicleId(entry.vehicle_id ?? "");
    setEditTime(new Date(entry.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false }));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(entry: PlanningEntry) {
    if (!editTourNumber || !editDriverId || !editVehicleId || !editTime) return;
    const day = entry.start_at.slice(0, 10);
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

  async function createEntry() {
    if (!formService || !formDriverId || !formVehicleId || !formTourNumber || !formTime) return;
    if (formWholeWeek && formDays.size === 0) return;
    setFormBusy(true);
    setError(null);
    setWarning(null);
    setBulkSummary(null);
    try {
      if (formWholeWeek) {
        const res = await fetch("/api/planning/entries/bulk-week", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: formService,
            driver_id: formDriverId,
            vehicle_id: formVehicleId,
            tour_number: formTourNumber,
            week_start: weekStart,
            time: formTime,
            days: Array.from(formDays),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
        if (json.warning) setWarning(json.warning);
        setBulkSummary(
          json.created > 0
            ? `${json.created} jour(s) affecté(s)${json.skipped > 0 ? ` (${json.skipped} déjà occupé(s), ignoré(s))` : ""}.`
            : "Rien à créer (tous les jours sélectionnés ont déjà une affectation).",
        );
      } else {
        const start = new Date(`${formDay}T${formTime}:00`);
        const res = await fetch("/api/planning/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_id: formService,
            driver_id: formDriverId,
            vehicle_id: formVehicleId,
            tour_number: formTourNumber,
            start_at: start.toISOString(),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
        if (json.warning) setWarning(json.warning);
      }
      setFormOpen(false);
      setFormTourNumber("");
      setFormDriverId("");
      setFormVehicleId("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(prevWeek, selectedService)}>
            ← Semaine préc.
          </button>
          <span className="text-sm text-navy/70">Semaine du {weekStart.split("-").reverse().join("/")}</span>
          <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(nextWeek, selectedService)}>
            Semaine suiv. →
          </button>
        </div>
        <button className="btn-secondary ml-auto !px-3 !py-1.5 text-sm" disabled={duplicating} onClick={duplicatePreviousWeek}>
          {duplicating ? "Copie…" : "📋 Dupliquer la semaine préc."}
        </button>
        <button className="btn-primary !px-3 !py-1.5 text-sm" onClick={() => setFormOpen((v) => !v)}>
          + Nouvelle affectation
        </button>
        {canValidate &&
          (selectedService ? (
            <button
              className="btn-primary !px-3 !py-1.5 text-sm"
              disabled={validating}
              onClick={validatePlanning}
              title={
                validatedAt
                  ? `Déjà envoyé le ${new Date(validatedAt).toLocaleDateString("fr-FR")} à ${new Date(validatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} — cliquez pour renvoyer avec les changements`
                  : undefined
              }
            >
              {validating ? "Envoi…" : validatedAt ? "✓ Envoyé — revalider" : "✅ Valider et envoyer"}
            </button>
          ) : (
            <span className="text-xs text-navy/60">Sélectionnez un service pour valider son planning</span>
          ))}
      </div>

      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {warning && <p className="text-sm text-gold-ink">⚠️ {warning}</p>}
      {duplicateSummary && <p className="text-sm text-teal-ink">{duplicateSummary}</p>}
      {bulkSummary && <p className="text-sm text-teal-ink">{bulkSummary}</p>}

      {formOpen && (
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
          <div>
            <label className="label">Service</label>
            <select className="input !w-auto" value={formService} onChange={(e) => setFormService(e.target.value)}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="checkbox" checked={formWholeWeek} onChange={(e) => setFormWholeWeek(e.target.checked)} />
            Toute la semaine
          </label>
          {formWholeWeek ? (
            <div className="flex flex-col gap-1">
              <label className="label">Jours</label>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`rounded-md px-2 py-1 text-xs ${
                      formDays.has(i) ? "bg-teal/20 text-teal-ink" : "bg-navy/5 text-navy/60"
                    }`}
                    onClick={() => toggleFormDay(i)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <label className="label">Jour</label>
              <select className="input !w-auto" value={formDay} onChange={(e) => setFormDay(e.target.value)}>
                {days.map((d, i) => (
                  <option key={d} value={d}>
                    {DAY_LABELS[i]} {d.split("-").reverse().join("/")}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Heure</label>
            <input className="input !w-auto" type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)} />
          </div>
          <div>
            <label className="label">N° de tournée</label>
            <input
              className="input !w-auto"
              value={formTourNumber}
              onChange={(e) => setFormTourNumber(e.target.value)}
              placeholder="ex: T-042"
            />
          </div>
          <div>
            <label className="label">Chauffeur</label>
            <select className="input !w-auto" value={formDriverId} onChange={(e) => selectDriver(e.target.value)}>
              <option value="">Choisir…</option>
              {drivers.map((d) => {
                const last = lastTourByDriver[d.id];
                return (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                    {last ? ` (dernière: n°${last.tourNumber})` : ""}
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="label">Véhicule</label>
            <select className="input !w-auto" value={formVehicleId} onChange={(e) => setFormVehicleId(e.target.value)}>
              <option value="">Choisir…</option>
              {vehicles
                .filter((v) => !formService || v.service_id === formService)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration}
                  </option>
                ))}
            </select>
          </div>
          <button
            className="btn-primary shrink-0"
            disabled={
              formBusy ||
              !formService ||
              !formDriverId ||
              !formVehicleId ||
              !formTourNumber ||
              (formWholeWeek && formDays.size === 0)
            }
            onClick={createEntry}
          >
            {formBusy ? "Envoi…" : formWholeWeek ? "Ajouter la semaine" : "Ajouter"}
          </button>
        </Card>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-2">
          <thead>
            <tr>
              <th className="w-40 text-left text-xs text-navy/60">Service</th>
              {days.map((d, i) => (
                <th key={d} className="text-left text-xs text-navy/60">
                  {DAY_LABELS[i]} {d.split("-").reverse().join("/")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredServices.map((service) => (
              <tr key={service.id}>
                <td className="align-top text-sm font-medium">{service.name}</td>
                {days.map((day) => {
                  const dayEntries = entries.filter(
                    (e) => e.service_id === service.id && e.start_at.slice(0, 10) === day,
                  );
                  return (
                    <td
                      key={day}
                      className="min-w-[140px] rounded-lg border border-dashed border-navy/10 align-top"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const entryId = e.dataTransfer.getData("text/plain");
                        if (entryId) moveEntry(entryId, service.id, day);
                      }}
                    >
                      <div className="flex flex-col gap-1 p-1">
                        {dayEntries.map((entry) => (
                          <div
                            key={entry.id}
                            draggable={entry.status === "planned" && editingId !== entry.id && duplicatingEntryId !== entry.id}
                            onDragStart={(e) => e.dataTransfer.setData("text/plain", entry.id)}
                            className={`rounded-md border border-navy/10 bg-white p-1.5 text-xs shadow-sm ${
                              entry.status === "planned" ? "cursor-move" : "opacity-80"
                            } ${busyId === entry.id ? "opacity-40" : ""}`}
                          >
                            <div className="mb-0.5 flex items-center justify-between gap-1">
                              <span className={STATUS_BADGE[entry.status] ?? "badge-neutral"}>
                                {STATUS_LABEL[entry.status] ?? entry.status}
                              </span>
                              <span className="flex items-center gap-1">
                                {entry.status === "planned" && editingId !== entry.id && (
                                  <button
                                    className="text-navy/60 hover:text-teal-ink"
                                    onClick={() => startEdit(entry)}
                                    aria-label="Modifier"
                                    title="Modifier"
                                  >
                                    ✎
                                  </button>
                                )}
                                {duplicatingEntryId !== entry.id && (
                                  <button
                                    className="text-navy/60 hover:text-teal-ink"
                                    onClick={() => openDuplicatePicker(entry)}
                                    aria-label="Dupliquer"
                                    title="Dupliquer"
                                  >
                                    ⧉
                                  </button>
                                )}
                                {entry.status === "planned" && (
                                  <button
                                    className="text-navy/60 hover:text-orange-ink"
                                    onClick={() => removeEntry(entry.id)}
                                    aria-label="Supprimer"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            </div>
                            {editingId === entry.id ? (
                              <div className="flex flex-col gap-1">
                                <input
                                  className="input !h-7 !py-0.5 !text-xs"
                                  value={editTourNumber}
                                  onChange={(e) => setEditTourNumber(e.target.value)}
                                  placeholder="N° tournée"
                                />
                                <select
                                  className="input !h-7 !py-0.5 !text-xs"
                                  value={editDriverId}
                                  onChange={(e) => setEditDriverId(e.target.value)}
                                >
                                  <option value="">Chauffeur…</option>
                                  {drivers.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.full_name}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  className="input !h-7 !py-0.5 !text-xs"
                                  value={editVehicleId}
                                  onChange={(e) => setEditVehicleId(e.target.value)}
                                >
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
                                  onChange={(e) => setEditTime(e.target.value)}
                                />
                                <div className="flex gap-1">
                                  <button
                                    className="btn-primary !h-6 flex-1 !px-1 !py-0 !text-[11px]"
                                    onClick={() => saveEdit(entry)}
                                  >
                                    OK
                                  </button>
                                  <button
                                    className="btn-secondary !h-6 flex-1 !px-1 !py-0 !text-[11px]"
                                    onClick={cancelEdit}
                                  >
                                    Annuler
                                  </button>
                                </div>
                              </div>
                            ) : duplicatingEntryId === entry.id ? (
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-navy/60">Dupliquer vers le</label>
                                <input
                                  className="input !h-7 !py-0.5 !text-xs"
                                  type="date"
                                  value={duplicateTargetDate}
                                  onChange={(e) => setDuplicateTargetDate(e.target.value)}
                                />
                                <div className="flex gap-1">
                                  <button
                                    className="btn-primary !h-6 flex-1 !px-1 !py-0 !text-[11px]"
                                    disabled={!duplicateTargetDate || busyId === entry.id}
                                    onClick={() => confirmDuplicateEntry(entry.id)}
                                  >
                                    OK
                                  </button>
                                  <button
                                    className="btn-secondary !h-6 flex-1 !px-1 !py-0 !text-[11px]"
                                    onClick={cancelDuplicatePicker}
                                  >
                                    Annuler
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="font-medium">n°{entry.tour_number}</p>
                                {entry.driver_id && entry.users ? (
                                  <button
                                    type="button"
                                    className="text-navy/70 underline-offset-2 hover:underline"
                                    onClick={() => setOpenDriverSheet({ id: entry.driver_id!, full_name: entry.users!.full_name })}
                                  >
                                    {entry.users.full_name}
                                  </button>
                                ) : (
                                  <p className="text-navy/70">—</p>
                                )}
                                <p className="text-navy/60">{entry.vehicles?.registration ?? "—"}</p>
                                <p className="text-navy/60">
                                  {new Date(entry.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                                </p>
                              </>
                            )}
                            {editingId !== entry.id && duplicatingEntryId !== entry.id && entry.users && (entry.users.phone || entry.users.email) && (
                              <div className="mt-1 flex gap-2 border-t border-navy/5 pt-1">
                                {entry.users.phone && (
                                  <a
                                    href={`https://wa.me/${toWhatsAppNumber(entry.users.phone)}?text=${encodeURIComponent(buildShareText(entry))}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-teal-ink hover:underline"
                                    title="Envoyer sur WhatsApp"
                                  >
                                    WhatsApp
                                  </a>
                                )}
                                {entry.users.email && (
                                  <a
                                    href={`mailto:${entry.users.email}?subject=${encodeURIComponent(`Tournée n°${entry.tour_number}`)}&body=${encodeURIComponent(buildShareText(entry))}`}
                                    className="text-teal-ink hover:underline"
                                    title="Envoyer par email"
                                  >
                                    Email
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
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
