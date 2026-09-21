"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { parseImportFile, vehicleCsvRowSchema, type VehicleCsvRow } from "@/lib/utils/csv";

/** API routes return either a plain string (thrown Error) or a zod .flatten() object — never {message}. */
function apiErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const flat = error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
    const messages = [...(flat.formErrors ?? []), ...Object.values(flat.fieldErrors ?? {}).flat()];
    if (messages.length > 0) return messages.join(" ");
  }
  return "Erreur";
}

/** Bulk vehicle import, embedded directly on the Flotte page instead of a separate admin screen. */
export function VehicleImportPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vehicles, setVehicles] = useState<VehicleCsvRow[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleFile(file: File) {
    setSummary(null);
    setError(null);
    const { rows, errors } = await parseImportFile(file, vehicleCsvRowSchema);
    setVehicles(rows);
    setFileErrors(errors.map((e) => (e.row ? `L${e.row} : ${e.message}` : e.message)));
  }

  async function submitImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles, drivers: [] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      setSummary(`${json.insertedVehicles} véhicule(s) ajouté(s).`);
      setVehicles([]);
      setFileErrors([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        Importer depuis un fichier
      </button>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="label">
          Fichier CSV ou Excel — colonnes : immatriculation, type, capacité cuve, kilométrage,
          service
        </p>
        <button className="shrink-0 text-sm text-navy/50 hover:text-navy" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        className="input"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      {vehicles.length > 0 && <p className="text-sm text-teal-ink">{vehicles.length} véhicule(s) prêt(s)</p>}
      {fileErrors.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-orange-ink">
          {fileErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {summary && <p className="text-sm text-teal-ink">{summary}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || vehicles.length === 0} onClick={submitImport}>
          {busy ? "Import en cours…" : "Importer"}
        </button>
      </div>
    </Card>
  );
}
