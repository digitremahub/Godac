"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { parseImportFile, vehicleCsvRowSchema, type VehicleCsvRow } from "@/lib/utils/csv";
import { IconSparkles } from "@/components/layout/icons";

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
  const [aiExtracted, setAiExtracted] = useState(false);
  const [importedVehicleIds, setImportedVehicleIds] = useState<string[]>([]);
  const [completing, setCompleting] = useState(false);
  const [completeSummary, setCompleteSummary] = useState<string | null>(null);

  async function handleFile(file: File) {
    setSummary(null);
    setError(null);
    const { rows, errors, aiExtracted } = await parseImportFile(file, vehicleCsvRowSchema, "vehicles");
    setVehicles(rows);
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
        body: JSON.stringify({ vehicles, drivers: [] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json.error));
      setSummary(`${json.insertedVehicles} véhicule(s) ajouté(s).`);
      setImportedVehicleIds((json.insertedVehicleIds as string[] | undefined) ?? []);
      setCompleteSummary(null);
      setVehicles([]);
      setFileErrors([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  /** Lot A: fills tank capacity/PTAC/etc. for the vehicles just imported, 10 at a time (the bulk endpoint's own cap). */
  async function completeByAi() {
    setCompleting(true);
    setCompleteSummary(null);
    setError(null);
    try {
      let updatedCount = 0;
      let skippedCount = 0;
      for (let i = 0; i < importedVehicleIds.length; i += 10) {
        const batch = importedVehicleIds.slice(i, i + 10);
        const res = await fetch("/api/vehicles/ai-specs/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicle_ids: batch }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(apiErrorMessage(json.error));
        for (const r of json.results as { updated: string[]; error?: string }[]) {
          if (r.updated.length > 0) updatedCount += 1;
          else skippedCount += 1;
        }
      }
      setCompleteSummary(
        `${updatedCount} véhicule(s) complété(s) par IA${skippedCount > 0 ? `, ${skippedCount} ignoré(s) (marque/modèle manquant ou déjà complet)` : ""}.`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setCompleting(false);
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
          service, marque, modèle (optionnel)
        </p>
        <button className="shrink-0 text-sm text-navy/65 hover:text-navy" onClick={() => setOpen(false)}>
          Fermer
        </button>
      </div>
      <input aria-label="Fichier d’import véhicules (CSV ou Excel)"
        type="file"
        accept=".csv,.xlsx,.xls"
        className="input"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      {vehicles.length > 0 && (
        <p className="text-sm text-teal-ink">
          {vehicles.length} véhicule(s) prêt(s)
          {aiExtracted && " — extraits par IA, ce fichier ne suivait pas un format de colonnes standard"}
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
      {importedVehicleIds.length > 0 && !completeSummary && (
        <div className="flex items-center justify-between rounded-lg bg-gold/10 p-3">
          <p className="text-sm text-gold-ink">Compléter automatiquement les champs vides (réservoir, PTAC…) pour les véhicules importés ?</p>
          <button className="btn-secondary shrink-0 !px-3 !py-1.5 text-xs" disabled={completing} onClick={completeByAi}>
            {completing ? "En cours…" : <><IconSparkles className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Compléter par IA</>}
          </button>
        </div>
      )}
      {completeSummary && <p role="status" className="text-sm text-teal-ink">{completeSummary}</p>}
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || vehicles.length === 0} onClick={submitImport}>
          {busy ? "Import en cours…" : "Importer"}
        </button>
      </div>
    </Card>
  );
}
