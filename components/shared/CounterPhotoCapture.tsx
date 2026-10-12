"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { IconCamera } from "@/components/layout/icons";

/**
 * Photographs a bare digit counter (tank/pump totalizer, vehicle
 * odometer) and tries to OCR-read it. Stateless w.r.t. whatever row
 * it's for — the caller attaches the returned photo path at submit
 * time (see app/api/ocr/totalizer and app/api/ocr/odometer, the two
 * init/process endpoint pairs this component can point at). Degrades
 * to manual entry exactly like ticket OCR does when extraction isn't
 * available.
 */
export function CounterPhotoCapture({
  label,
  initUrl,
  processUrl,
  bucket,
  onCaptured,
}: {
  label: string;
  initUrl: string;
  processUrl: string;
  bucket: string;
  onCaptured: (result: { photoPath: string; reading: number | null }) => void;
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
      const initRes = await fetch(initUrl, { method: "POST" });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(typeof initJson.error === "string" ? initJson.error : "Erreur d'initialisation");
      const { storagePath } = initJson as { storagePath: string };

      const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué: ${uploadError.message}`);

      setStatus("extracting");
      const processRes = await fetch(processUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storagePath }),
      });
      const processJson = await processRes.json();
      const reading = processRes.ok ? ((processJson.reading as number | null) ?? null) : null;
      if (reading === null) {
        setError(processJson.error ?? "Lecture automatique indisponible — vérifiez le chiffre.");
      }
      setStatus("done");
      onCaptured({ photoPath: storagePath, reading });
    } catch (e) {
      setStatus("error");
      setError(networkErrorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img width={112} height={64} src={preview} alt="Compteur" className="h-16 w-28 rounded-lg border border-navy/10 object-cover" />
      )}
      <label className="btn-secondary min-h-[44px] w-full cursor-pointer justify-center text-center !py-1 text-xs">
        {status === "uploading" && "Envoi…"}
        {status === "extracting" && "Lecture…"}
        {(status === "idle" || status === "error" || status === "done") && <><IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> {label}</>}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={status === "uploading" || status === "extracting"}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>
      {error && <p role="alert" className="text-xs text-orange-ink">{error}</p>}
    </div>
  );
}
