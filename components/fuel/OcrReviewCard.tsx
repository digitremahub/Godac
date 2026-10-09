"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { FuelEntryForm, type FuelEntryFormValues } from "@/components/fuel/FuelEntryForm";

export function OcrReviewCard({ entry }: { entry: any }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(values: FuelEntryFormValues, markManual: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fuel-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occurred_at: new Date(values.occurred_at).toISOString(),
          totalizer_before: values.totalizer_before ? Number(values.totalizer_before) : null,
          totalizer_after: Number(values.totalizer_after),
          totalizer_before_photo_path: values.totalizer_before_photo_path || undefined,
          totalizer_after_photo_path: values.totalizer_after_photo_path || undefined,
          vehicle_km: values.vehicle_km ? Number(values.vehicle_km) : undefined,
          liters: Number(values.liters),
          unit_price: Number(values.unit_price),
          station_name: values.station_name || undefined,
          ...(markManual ? { markManual: true } : { validate: true }),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erreur");
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">
          {entry.vehicles?.registration ?? "—"} · {entry.users?.full_name ?? "—"}
        </p>
        <span className={entry.status === "ocr_failed" ? "badge-orange" : "badge-gold"}>
          {entry.status === "ocr_failed" ? "Échec OCR" : "À valider"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          {entry.photoUrl ? (
            <img src={entry.photoUrl} alt="Ticket" className="max-h-96 w-full rounded-xl object-contain" />
          ) : (
            <p className="text-sm text-navy/40">Aucune photo disponible</p>
          )}
          {entry.ocr_confidence && (
            <div className="mt-2 text-xs text-navy/40">
              Confiance OCR:{" "}
              {Object.entries(entry.ocr_confidence)
                .filter(([, v]) => v !== null)
                .map(([k, v]: [string, any]) => `${k}: ${Math.round(v * 100)}%`)
                .join(" · ") || "n/a"}
            </div>
          )}
          {entry.ocr_error && <p className="mt-2 text-xs text-orange-ink">{entry.ocr_error}</p>}
        </div>

        <div>
          {error && <p className="mb-2 text-sm text-orange-ink">{error}</p>}
          <FuelEntryForm
            initialValues={{
              occurred_at: entry.occurred_at?.slice(0, 16),
              liters: entry.liters?.toString(),
              unit_price: entry.unit_price?.toString(),
              totalizer_before: entry.totalizer_before?.toString(),
              totalizer_after: entry.totalizer_after?.toString(),
              vehicle_km: entry.vehicle_km?.toString(),
              station_name: entry.station_name ?? "",
            }}
            submitLabel="Valider"
            busy={busy}
            totalizerOcrEnabled
            showPriceFields
            onSubmit={(v) => submit(v, entry.status === "ocr_failed")}
          />
        </div>
      </div>
    </Card>
  );
}
