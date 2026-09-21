"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import {
  parseImportFile,
  vehicleCsvRowSchema,
  driverCsvRowSchema,
  type VehicleCsvRow,
  type DriverCsvRow,
} from "@/lib/utils/csv";

interface ImportSummary {
  insertedVehicles: number;
  invitationsSent: number;
  invitationFailures: { email: string; error: string }[];
}

/**
 * Ongoing bulk import of vehicles + drivers (Admin > Import), so a
 * company doesn't only get one shot at this during onboarding — the
 * same CSV formats, posted to /api/admin/import instead of the
 * onboarding-only route.
 */
export function BulkImportPanel() {
  const [vehicles, setVehicles] = useState<VehicleCsvRow[]>([]);
  const [drivers, setDrivers] = useState<DriverCsvRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function handleFile(kind: "vehicles" | "drivers", file: File) {
    setSummary(null);
    setError(null);
    if (kind === "vehicles") {
      const { rows, errors } = await parseImportFile(file, vehicleCsvRowSchema);
      setVehicles(rows);
      setCsvErrors(errors.map((e) => (e.row ? `Véhicules L${e.row}: ${e.message}` : `Véhicules: ${e.message}`)));
    } else {
      const { rows, errors } = await parseImportFile(file, driverCsvRowSchema);
      setDrivers(rows);
      setCsvErrors((prev) => [
        ...prev.filter((e) => !e.startsWith("Chauffeurs")),
        ...errors.map((e) => (e.row ? `Chauffeurs L${e.row}: ${e.message}` : `Chauffeurs: ${e.message}`)),
      ]);
    }
  }

  async function submitImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles, drivers }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur import");
      setSummary(json);
      setVehicles([]);
      setDrivers([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-6">
      <div>
        <p className="label">
          Véhicules — CSV, Excel ou PDF (colonnes : immatriculation, type, capacité cuve,
          kilométrage, service)
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls,.pdf"
          className="input"
          onChange={(e) => e.target.files?.[0] && handleFile("vehicles", e.target.files[0])}
        />
        {vehicles.length > 0 && <p className="mt-1 text-sm text-teal-ink">{vehicles.length} véhicule(s) prêt(s)</p>}
      </div>
      <div>
        <p className="label">
          Chauffeurs / équipe — CSV, Excel ou PDF (colonnes : nom, email, rôle, téléphone, service)
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls,.pdf"
          className="input"
          onChange={(e) => e.target.files?.[0] && handleFile("drivers", e.target.files[0])}
        />
        {drivers.length > 0 && <p className="mt-1 text-sm text-teal-ink">{drivers.length} invitation(s) prête(s)</p>}
        <p className="mt-1 text-xs text-navy/40">
          Pour un PDF : un tableau texte fonctionne (export Word/Excel imprimé en PDF) — un PDF
          scanné (image) n&apos;est pas supporté.
        </p>
      </div>

      {csvErrors.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-orange-ink">
          {csvErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-orange-ink">{error}</p>}

      {summary && (
        <div className="rounded-lg border border-teal/30 bg-teal/5 p-3 text-sm text-navy/70">
          <p>{summary.insertedVehicles} véhicule(s) ajouté(s), {summary.invitationsSent} invitation(s) envoyée(s).</p>
          {summary.invitationFailures.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-orange-ink">
              {summary.invitationFailures.map((f, i) => (
                <li key={i}>{f.email}: {f.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || (vehicles.length === 0 && drivers.length === 0)} onClick={submitImport}>
          {busy ? "Import en cours…" : "Importer"}
        </button>
      </div>
    </Card>
  );
}
