"use client";

import { useState } from "react";
import { useSupabaseClient } from "@/lib/supabase/client";

export interface OcrCaptureResult {
  fuelEntryId: string;
  extractedFields: {
    occurred_at?: string;
    liters?: number;
    unit_price?: number;
    station_name?: string;
  } | null;
  status: "awaiting_validation" | "ocr_failed";
  ocrError?: string;
}

/**
 * Mobile-first ticket capture (Module 3). Uses a plain
 * `<input type="file" capture="environment">` rather than a custom
 * getUserMedia widget: it opens the native camera app on every phone
 * without extra permissions UX, and falls back to a normal file
 * picker on desktop for managers testing the flow.
 */
export function CameraCapture({
  vehicleId,
  tankId,
  driverId,
  onResult,
}: {
  vehicleId: string;
  tankId: string;
  driverId?: string;
  onResult: (result: OcrCaptureResult) => void;
}) {
  const supabase = useSupabaseClient();
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "extracting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setPreview(URL.createObjectURL(file));
    setError(null);
    setStatus("uploading");

    try {
      const initRes = await fetch("/api/ocr/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicle_id: vehicleId, tank_id: tankId, driver_id: driverId }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error ?? "Erreur d'initialisation");

      const { fuelEntryId, storagePath } = initJson as { fuelEntryId: string; storagePath: string };

      const { error: uploadError } = await supabase.storage
        .from(process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? "fuel-tickets")
        .upload(storagePath, file, { contentType: file.type, upsert: true });
      if (uploadError) throw new Error(`Upload échoué: ${uploadError.message}`);

      setStatus("extracting");
      const processRes = await fetch("/api/ocr/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fuelEntryId, ticketPhotoPath: storagePath }),
      });
      const processJson = await processRes.json();
      if (!processRes.ok) throw new Error(processJson.error ?? "Extraction échouée");

      // Re-fetch the row for the extracted values (kept simple: a
      // second round trip instead of returning the full row from
      // /api/ocr/process, so that route stays a thin trigger).
      const detailRes = await fetch(`/api/fuel-entries/${fuelEntryId}`);
      const detail = detailRes.ok ? await detailRes.json() : null;

      onResult({
        fuelEntryId,
        status: detail?.fuelEntry?.status === "ocr_failed" ? "ocr_failed" : "awaiting_validation",
        ocrError: detail?.fuelEntry?.ocr_error ?? undefined,
        extractedFields: detail?.fuelEntry
          ? {
              occurred_at: detail.fuelEntry.occurred_at,
              liters: detail.fuelEntry.liters ?? undefined,
              unit_price: detail.fuelEntry.unit_price ?? undefined,
              station_name: detail.fuelEntry.station_name ?? undefined,
            }
          : null,
      });
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {preview && (
        <img src={preview} alt="Ticket capturé" className="max-h-64 rounded-xl border border-white/10" />
      )}

      <label className="btn-primary w-full cursor-pointer justify-center text-center">
        {status === "uploading" && "Envoi de la photo…"}
        {status === "extracting" && "Analyse du ticket…"}
        {(status === "idle" || status === "error") && "📷 Prendre une photo du ticket"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={status === "uploading" || status === "extracting"}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>

      {error && <p className="text-sm text-orange">{error} — vous pouvez continuer en saisie manuelle.</p>}
    </div>
  );
}
