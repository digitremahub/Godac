"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { IconPaperclip } from "@/components/layout/icons";

const DOC_TYPES = [
  "Contrat de travail",
  "Avenant au contrat",
  "Pièce d'identité",
  "Titre de séjour / autorisation de travail",
  "Permis de conduire",
  "Visite médicale (aptitude)",
  "Diplôme / certification",
  "Autre",
] as const;

export interface EmployeeDocument {
  id: string;
  docType: string;
  uploadedAt: string;
  downloadUrl: string | null;
}

/**
 * Direction-only document vault for a driver's fiche — contrat, pièce
 * d'identité, visite médicale d'aptitude, etc. Stored in the private
 * `employee-documents` bucket (RLS: own record or direction, see
 * 20260101000017). Same upload-then-confirm shape as
 * TourReportPhotoCapture, just with a doc-type picker instead of OCR.
 */
export function EmployeeDocumentsPanel({ userId, documents }: { userId: string; documents: EmployeeDocument[] }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]>(DOC_TYPES[0]);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    try {
      const initRes = await fetch(`/api/admin/users/${userId}/employee-documents/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(typeof initJson.error === "string" ? initJson.error : "Erreur d'initialisation");
      const { storagePath, employeeFileId } = initJson as { storagePath: string; employeeFileId: string };

      const { error: uploadError } = await supabase.storage
        .from("employee-documents")
        .upload(storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué: ${uploadError.message}`);

      const confirmRes = await fetch(`/api/admin/users/${userId}/employee-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeFileId, docType, filePath: storagePath }),
      });
      const confirmJson = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(typeof confirmJson.error === "string" ? confirmJson.error : "Erreur");

      setStatus("idle");
      router.refresh();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm font-medium">Documents</p>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      {documents.length === 0 ? (
        <p className="text-xs text-navy/60">Aucun document déposé.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{doc.docType}</span>
              <span className="flex items-center gap-2 text-xs text-navy/60">
                {new Date(doc.uploadedAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}
                {doc.downloadUrl && (
                  <a href={doc.downloadUrl} target="_blank" rel="noreferrer" className="text-teal-ink underline">
                    Ouvrir
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Type de document"
          className="input !w-auto !py-1.5 text-sm"
          value={docType}
          onChange={(e) => setDocType(e.target.value as (typeof DOC_TYPES)[number])}
        >
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="btn-secondary cursor-pointer !px-3 !py-1.5 text-xs">
          {status === "uploading" ? "Envoi…" : <><IconPaperclip className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Ajouter un document</>}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            disabled={status === "uploading"}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>
      </div>
    </Card>
  );
}
