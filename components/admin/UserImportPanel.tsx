"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { parseImportFile, driverCsvRowSchema, type DriverCsvRow } from "@/lib/utils/csv";

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

/** Bulk invitation from a file, embedded directly on Admin > Utilisateurs instead of a separate admin screen. */
export function UserImportPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drivers, setDrivers] = useState<DriverCsvRow[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [aiExtracted, setAiExtracted] = useState(false);

  async function handleFile(file: File) {
    setSummary(null);
    setError(null);
    const { rows, errors, aiExtracted } = await parseImportFile(file, driverCsvRowSchema, "drivers");
    setDrivers(rows);
    setFileErrors(errors.map((e) => (e.row ? `L${e.row} : ${e.message}` : e.message)));
    setAiExtracted(!!aiExtracted);
  }

  async function submitImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicles: [], drivers }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      const failures = json.invitationFailures as { email: string; error: string }[];
      setSummary(
        `${json.invitationsSent} invitation(s) envoyée(s).` +
          (failures.length > 0 ? ` ${failures.length} échec(s) : ${failures.map((f) => f.email).join(", ")}.` : ""),
      );
      setDrivers([]);
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
        <p className="label">Fichier CSV ou Excel — colonnes : nom, email, rôle, téléphone, service</p>
        <button className="shrink-0 text-sm text-navy/65 hover:text-navy" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>
      <input aria-label="Fichier d’import utilisateurs (CSV ou Excel)"
        type="file"
        accept=".csv,.xlsx,.xls"
        className="input"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      {drivers.length > 0 && (
        <p className="text-sm text-teal-ink">
          {drivers.length} invitation(s) prête(s)
          {aiExtracted && " — extraites par IA, ce fichier ne suivait pas un format de colonnes standard"}
        </p>
      )}
      {fileErrors.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-orange-ink">
          {fileErrors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {summary && <p role="status" className="text-sm text-teal-ink">{summary}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || drivers.length === 0} onClick={submitImport}>
          {busy ? "Import en cours…" : "Importer"}
        </button>
      </div>
    </Card>
  );
}
