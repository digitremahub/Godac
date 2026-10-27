"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { FuelEntryForm, type FuelEntryFormValues } from "@/components/fuel/FuelEntryForm";
import { ConfirmerControles } from "@/components/fuel/ConfirmerControles";
import { CODE_CONTROLE_A_CONFIRMER, type ControleSaisie } from "@/lib/fuel/controles-saisie";
import { fuelEntryPayload } from "@/lib/fuel/entry-payload";
import { ticketExtrasFromOcrRaw } from "@/lib/ocr/ticket-check";
import { isoToDatetimeLocal } from "@/lib/utils/datetime-local";

export function OcrReviewCard({ entry }: { entry: any }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Contrôle de saisie en échec (kilométrage, réservoir) : confirmer avec un motif plutôt que perdre la relecture.
  const [aConfirmer, setAConfirmer] = useState<{ controles: ControleSaisie[]; valeurs: FuelEntryFormValues; markManual: boolean } | null>(null);
  // Un ticket photographié vient d'une station ; une ligne déjà
  // rattachée à une cuve peut l'être à tort (ancien parcours OCR qui
  // imposait une cuve) — le relecteur peut la détacher.
  const [station, setStation] = useState(!entry.tank_id);
  const ticket = ticketExtrasFromOcrRaw(entry.ocr_raw);

  async function submit(values: FuelEntryFormValues, markManual: boolean, motif?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fuel-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...fuelEntryPayload(values, { station, method: "PATCH" }),
          ...(markManual ? { markManual: true } : { validate: true }),
          ...(motif ? { confirmer_controles: { motif } } : {}),
        }),
      });
      const json = await res.json();
      if (res.status === 409 && json.code === CODE_CONTROLE_A_CONFIRMER && Array.isArray(json.controles)) {
        setAConfirmer({ controles: json.controles, valeurs: values, markManual });
        if (motif) setError(typeof json.error === "string" ? json.error : null);
        return;
      }
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Données refusées — vérifiez les champs.");
      setAConfirmer(null);
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
            <p className="text-sm text-navy/60">Aucune photo disponible</p>
          )}
          {entry.ocr_confidence && (
            <div className="mt-2 text-xs text-navy/60">
              Confiance OCR:{" "}
              {Object.entries(entry.ocr_confidence)
                .filter(([, v]) => v !== null)
                .map(([k, v]: [string, any]) => `${k}: ${Math.round(v * 100)}%`)
                .join(" · ") || "n/a"}
            </div>
          )}
          {(ticket.total_amount !== null || ticket.fuel_type) && (
            <p className="mt-2 text-xs text-navy/60">
              Lu sur le ticket : {ticket.fuel_type ?? "carburant non lu"}
              {ticket.total_amount !== null && ` · total ${ticket.total_amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}`}
            </p>
          )}
          {entry.tank_id && <p className="mt-2 text-xs text-navy/60">Cuve : {entry.tanks?.name ?? "—"}</p>}
          {entry.ocr_error && <p className="mt-2 text-xs text-orange-ink">{entry.ocr_error}</p>}
        </div>

        <div>
          {error && <p role="alert" className="mb-2 text-sm text-orange-ink">{error}</p>}
          <FuelEntryForm
            initialValues={{
              occurred_at: isoToDatetimeLocal(entry.occurred_at),
              liters: entry.liters?.toString(),
              unit_price: entry.unit_price?.toString(),
              totalizer_before: entry.totalizer_before?.toString(),
              totalizer_after: entry.totalizer_after?.toString(),
              vehicle_km: entry.vehicle_km?.toString(),
              station_name: entry.station_name ?? "",
              product: entry.product === "adblue" ? "adblue" : "gazole",
            }}
            submitLabel="Valider"
            busy={busy}
            totalizerOcrEnabled
            showPriceFields
            station={station}
            onStationChange={entry.tank_id ? setStation : undefined}
            ticket={ticket}
            bas={
              aConfirmer && (
                <ConfirmerControles
                  controles={aConfirmer.controles}
                  busy={busy}
                  onConfirmer={(motif) => submit(aConfirmer.valeurs, aConfirmer.markManual, motif)}
                  onCorriger={() => setAConfirmer(null)}
                />
              )
            }
            onSubmit={(v) => submit(v, entry.status === "ocr_failed")}
          />
        </div>
      </div>
    </Card>
  );
}
