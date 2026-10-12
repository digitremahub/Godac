"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TourReportPhotoCapture } from "@/components/shared/TourReportPhotoCapture";
import type { TourReportFields } from "@/lib/ocr/tour-report";

/**
 * Recovers a tour closed without its report photo ever saving — the
 * photo upload was never required to close a tour (EndTourFlow/
 * StartTourFlow's canSubmit), so a network failure mid-capture (see
 * lib/utils/network-error.ts) can leave a "done" tour with zero
 * report data and nobody the wiser. Direction re-photographs the same
 * paper report here; POSTs to app/api/reports/[id]/attach-photo,
 * which replays the live flows' OCR→column mapping.
 */
export function AttachReportPhotoButton({ planningEntryId, stage }: { planningEntryId: string; stage: "start" | "end" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCaptured({ photoPath, fields }: { photoPath: string; fields: TourReportFields | null }) {
    setError(null);
    try {
      const res = await fetch(`/api/reports/${planningEntryId}/attach-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, photo_path: photoPath, fields: fields ?? {} }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    }
  }

  if (!open) {
    return (
      <button className="text-xs text-orange-ink underline" onClick={() => setOpen(true)}>
        📎 Photo manquante
      </button>
    );
  }

  return (
    <div className="flex w-32 flex-col gap-1">
      <TourReportPhotoCapture label={stage === "start" ? "Rapport départ" : "Rapport retour"} onCaptured={handleCaptured} />
      {error && <p role="alert" className="text-xs text-orange-ink">{error}</p>}
      <button className="text-xs text-navy/60 underline" onClick={() => setOpen(false)}>
        Annuler
      </button>
    </div>
  );
}
