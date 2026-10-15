"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { networkErrorMessage } from "@/lib/utils/network-error";
import type { TourReportFields } from "@/lib/ocr/tour-report";
import { IconFileText, IconPaperclip } from "@/components/layout/icons";

/**
 * Lot C: captures a tour report (handheld "Statistiques Tournée"
 * screen at departure, or the printed compte-rendu at return) and
 * tries to read it via Claude vision (lib/ocr/tour-report.ts) instead
 * of retyping the tour number/stops/colis by hand. Accepts a camera
 * photo, an existing image, or a scanned PDF — téléversé depuis le
 * téléphone ou depuis un PC, pas seulement pris sur le moment — same
 * upload-then-process shape as components/shared/CounterPhotoCapture,
 * just returning a whole set of fields instead of one number — and
 * degrading the same way to "just attach the photo" when extraction
 * isn't available or fails.
 */
export function TourReportPhotoCapture({
  label,
  onCaptured,
}: {
  label: string;
  onCaptured: (result: { photoPath: string; fields: TourReportFields | null }) => void;
}) {
  const supabase = createBrowserSupabaseClient();
  const [status, setStatus] = useState<"idle" | "uploading" | "extracting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);

  async function handleFile(file: File) {
    setIsPdf(file.type === "application/pdf");
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    setFileName(file.name);
    setError(null);
    setStatus("uploading");
    let uploadedPath: string | null = null;
    try {
      const initRes = await fetch("/api/ocr/tour-report/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(typeof initJson.error === "string" ? initJson.error : "Erreur d'initialisation");
      const { storagePath } = initJson as { storagePath: string };

      const { error: uploadError } = await supabase.storage.from("tour-photos").upload(storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué: ${uploadError.message}`);
      uploadedPath = storagePath;

      // Persist the attachment in the parent form as soon as storage confirms
      // the upload. OCR is a separate best-effort step and must never make the
      // uploaded document disappear from the tour report if processing fails.
      onCaptured({ photoPath: storagePath, fields: null });
      setStatus("extracting");
      try {
        const processRes = await fetch("/api/ocr/tour-report/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath }),
        });
        const processJson = await processRes.json();
        const fields = processRes.ok ? ((processJson.fields as TourReportFields | null) ?? null) : null;
        if (!fields) {
          setError(processJson.error ?? "Lecture automatique indisponible — le document est bien envoyé et sera conservé.");
        }
        setStatus("done");
        onCaptured({ photoPath: storagePath, fields });
      } catch (e) {
        // A network error during OCR used to skip onCaptured entirely, leaving
        // the file in Storage but no path on planning_entries: reports then
        // incorrectly showed "manquant" for a document the driver had sent.
        setStatus("done");
        setError(`Document envoyé et attaché ; lecture OCR indisponible : ${networkErrorMessage(e)}`);
        onCaptured({ photoPath: storagePath, fields: null });
      }
    } catch (e) {
      setStatus("error");
      setError(networkErrorMessage(e));
      if (uploadedPath) {
        setStatus("done");
        onCaptured({ photoPath: uploadedPath, fields: null });
      }
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img width={128} height={80} src={preview} alt="Rapport de tournée" className="h-20 w-32 rounded-lg border border-navy/10 object-cover" />
      )}
      {isPdf && fileName && <p className="text-xs text-navy/65"><IconFileText className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> {fileName}</p>}
      <label className="btn-secondary min-h-[44px] w-full cursor-pointer justify-center text-center !py-1.5 text-xs">
        {status === "uploading" && "Envoi…"}
        {status === "extracting" && "Lecture…"}
        {(status === "idle" || status === "error" || status === "done") && <><IconPaperclip className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> {label}</>}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          disabled={status === "uploading" || status === "extracting"}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>
      {error && <p role="alert" className="text-xs text-orange-ink">{error}</p>}
    </div>
  );
}
