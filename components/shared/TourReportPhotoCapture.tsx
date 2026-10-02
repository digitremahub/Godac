"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { TourReportFields } from "@/lib/ocr/tour-report";

/**
 * Lot C: photographs a tour report (handheld "Statistiques Tournée"
 * screen at departure, or the printed compte-rendu at return) and
 * tries to read it via Claude vision (lib/ocr/tour-report.ts) instead
 * of retyping the tour number/stops/colis by hand. Same
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

  async function handleFile(file: File) {
    setPreview(URL.createObjectURL(file));
    setError(null);
    setStatus("uploading");
    try {
      const initRes = await fetch("/api/ocr/tour-report/init", { method: "POST" });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(typeof initJson.error === "string" ? initJson.error : "Erreur d'initialisation");
      const { storagePath } = initJson as { storagePath: string };

      const { error: uploadError } = await supabase.storage.from("tour-photos").upload(storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué: ${uploadError.message}`);

      setStatus("extracting");
      const processRes = await fetch("/api/ocr/tour-report/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath }),
      });
      const processJson = await processRes.json();
      const fields = processRes.ok ? ((processJson.fields as TourReportFields | null) ?? null) : null;
      if (!fields) {
        setError(processJson.error ?? "Lecture automatique indisponible — la photo reste attachée.");
      }
      setStatus("done");
      onCaptured({ photoPath: storagePath, fields });
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Rapport de tournée" className="h-20 w-32 rounded-lg border border-navy/10 object-cover" />
      )}
      <label className="btn-secondary w-full cursor-pointer justify-center text-center !py-1.5 text-xs">
        {status === "uploading" && "Envoi…"}
        {status === "extracting" && "Lecture…"}
        {(status === "idle" || status === "error" || status === "done") && `📷 ${label}`}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={status === "uploading" || status === "extracting"}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>
      {error && <p className="text-[11px] text-orange-ink">{error}</p>}
    </div>
  );
}
