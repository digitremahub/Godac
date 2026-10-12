"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { AttachReportPhotoButton } from "@/components/reports/AttachReportPhotoButton";
import { IconPencil } from "@/components/layout/icons";

export interface ReportRow {
  id: string;
  tour_number: string;
  start_at: string;
  end_at: string | null;
  start_photo_path: string | null;
  end_photo_path: string | null;
  report_bl_number: string | null;
  report_stops_total: number | null;
  report_packages_count: number | null;
  report_priority_count: number | null;
  report_stops_delivered: number | null;
  report_packages_missing: number | null;
  report_pickups: number | null;
  report_packages_picked_up: number | null;
  report_packages_returned: number | null;
  report_packages_relay: number | null;
  report_departure_time: string | null;
  report_return_time: string | null;
  services: { name: string } | null;
  vehicles: { registration: string } | null;
  users: { full_name: string } | null;
}

type EditableField =
  | "report_bl_number"
  | "report_stops_total"
  | "report_packages_count"
  | "report_priority_count"
  | "report_stops_delivered"
  | "report_packages_missing"
  | "report_pickups"
  | "report_packages_picked_up"
  | "report_packages_returned"
  | "report_packages_relay"
  | "report_departure_time"
  | "report_return_time";

const FIELD_LABELS: Record<EditableField, string> = {
  report_bl_number: "N° de BL",
  report_stops_total: "Arrêts",
  report_packages_count: "Colis",
  report_priority_count: "Colis prioritaires",
  report_stops_delivered: "Arrêts livrés",
  report_packages_missing: "Colis manquants",
  report_pickups: "Ramasses",
  report_packages_picked_up: "Colis ramassés",
  report_packages_returned: "Colis ramenés au dépôt",
  report_packages_relay: "Colis en relais",
  report_departure_time: "Heure de départ",
  report_return_time: "Heure de retour",
};

const NUMERIC_FIELDS = new Set<EditableField>([
  "report_stops_total",
  "report_packages_count",
  "report_priority_count",
  "report_stops_delivered",
  "report_packages_missing",
  "report_pickups",
  "report_packages_picked_up",
  "report_packages_returned",
  "report_packages_relay",
]);

type FormState = Record<EditableField, string>;

function toFormState(r: ReportRow): FormState {
  return {
    report_bl_number: r.report_bl_number ?? "",
    report_stops_total: r.report_stops_total?.toString() ?? "",
    report_packages_count: r.report_packages_count?.toString() ?? "",
    report_priority_count: r.report_priority_count?.toString() ?? "",
    report_stops_delivered: r.report_stops_delivered?.toString() ?? "",
    report_packages_missing: r.report_packages_missing?.toString() ?? "",
    report_pickups: r.report_pickups?.toString() ?? "",
    report_packages_picked_up: r.report_packages_picked_up?.toString() ?? "",
    report_packages_returned: r.report_packages_returned?.toString() ?? "",
    report_packages_relay: r.report_packages_relay?.toString() ?? "",
    report_departure_time: r.report_departure_time ?? "",
    report_return_time: r.report_return_time ?? "",
  };
}

/**
 * Read-only for everyone except direction (see app/api/reports/[id] —
 * the role gate lives there too, this just hides the affordance).
 * Direction clicks a row to turn every report_* cell into an input at
 * once, fixing whatever the OCR pass on the tour-report photo missed
 * or misread, since retaking that photo isn't an option after the
 * fact.
 */
export function ReportsTable({ reports, canEdit }: { reports: ReportRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(r: ReportRow) {
    setEditingId(r.id);
    setForm(toFormState(r));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(null);
  }

  function setField(field: EditableField, value: string) {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  async function save(id: string) {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(form) as [EditableField, string][]) {
        if (NUMERIC_FIELDS.has(key)) {
          body[key] = value.trim() === "" ? null : Number(value);
        } else {
          body[key] = value.trim() === "" ? null : value.trim();
        }
      }
      const res = await fetch(`/api/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setEditingId(null);
      setForm(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  function cell(r: ReportRow, field: EditableField, display: string) {
    if (editingId !== r.id || !form) {
      return display;
    }
    return (
      <input aria-label={FIELD_LABELS[field]}
        className="input !h-7 !w-20 !py-0.5 !text-xs"
        type={NUMERIC_FIELDS.has(field) ? "number" : "text"}
        min={NUMERIC_FIELDS.has(field) ? 0 : undefined}
        value={form[field]}
        onChange={(e) => setField(field, e.target.value)}
      />
    );
  }

  return (
    <Card className="overflow-x-auto">
      {error && <p role="alert" className="mb-2 text-sm text-orange-ink">{error}</p>}
      <table className="w-full min-w-[1420px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Date</th>
            <th className="pb-2">Chauffeur</th>
            <th className="pb-2">Service</th>
            <th className="pb-2">Véhicule</th>
            <th className="pb-2">Tournée</th>
            <th className="pb-2">BL</th>
            <th className="pb-2" title="Heure imprimée sur le rapport de tournée, lue par l'OCR">
              Départ (BL)
            </th>
            <th className="pb-2" title="Heure imprimée sur le rapport de tournée, lue par l'OCR">
              Retour (BL)
            </th>
            <th className="pb-2">Départ</th>
            <th className="pb-2">Retour</th>
            <th className="pb-2">Arrêts</th>
            <th className="pb-2">Livrés</th>
            <th className="pb-2">Colis</th>
            <th className="pb-2">Priorité</th>
            <th className="pb-2">Manquants</th>
            <th className="pb-2">Ramassés</th>
            <th className="pb-2">Ramenés dépôt</th>
            <th className="pb-2">En relais</th>
            {canEdit && <th className="pb-2">Photo</th>}
            {canEdit && <th className="pb-2" />}
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} className="border-t border-navy/5">
              <td className="py-2">
                {new Date(r.start_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
              </td>
              <td className="py-2">{r.users?.full_name ?? "—"}</td>
              <td className="py-2">{r.services?.name ?? "—"}</td>
              <td className="py-2">{r.vehicles?.registration ?? "—"}</td>
              <td className="py-2">n°{r.tour_number}</td>
              <td className="py-2">{cell(r, "report_bl_number", r.report_bl_number ?? "—")}</td>
              <td className="py-2">{cell(r, "report_departure_time", r.report_departure_time ?? "—")}</td>
              <td className="py-2">{cell(r, "report_return_time", r.report_return_time ?? "—")}</td>
              <td className="py-2" title="Heure du scan de départ, pas l'heure imprimée sur le BL">
                {new Date(r.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </td>
              <td className="py-2" title="Heure du scan de retour, pas l'heure imprimée sur le BL">
                {r.end_at ? new Date(r.end_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}
              </td>
              <td className="py-2">{cell(r, "report_stops_total", r.report_stops_total?.toString() ?? "—")}</td>
              <td className="py-2">{cell(r, "report_stops_delivered", r.report_stops_delivered?.toString() ?? "—")}</td>
              <td className="py-2">{cell(r, "report_packages_count", r.report_packages_count?.toString() ?? "—")}</td>
              <td className="py-2">{cell(r, "report_priority_count", r.report_priority_count?.toString() ?? "—")}</td>
              <td className="py-2">{cell(r, "report_packages_missing", r.report_packages_missing?.toString() ?? "—")}</td>
              <td className="py-2">{cell(r, "report_pickups", r.report_pickups?.toString() ?? "—")}</td>
              <td className="py-2">{cell(r, "report_packages_picked_up", r.report_packages_picked_up?.toString() ?? "—")}</td>
              <td className="py-2">{cell(r, "report_packages_returned", r.report_packages_returned?.toString() ?? "—")}</td>
              <td className="py-2">{cell(r, "report_packages_relay", r.report_packages_relay?.toString() ?? "—")}</td>
              {canEdit && (
                <td className="py-2">
                  <div className="flex flex-col gap-1">
                    {!r.start_photo_path && <AttachReportPhotoButton planningEntryId={r.id} stage="start" />}
                    {!r.end_photo_path && <AttachReportPhotoButton planningEntryId={r.id} stage="end" />}
                  </div>
                </td>
              )}
              {canEdit && (
                <td className="py-2">
                  {editingId === r.id ? (
                    <div className="flex gap-1">
                      <button className="btn-primary !h-6 !px-2 !py-0 !text-xs" disabled={busy} onClick={() => save(r.id)}>
                        OK
                      </button>
                      <button className="btn-secondary !h-6 !px-2 !py-0 !text-xs" disabled={busy} onClick={cancelEdit}>
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      className="text-navy/60 hover:text-teal-ink"
                      onClick={() => startEdit(r)}
                      aria-label="Modifier"
                      title="Modifier"
                    >
                      <IconPencil className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" />
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
