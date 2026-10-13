"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { CounterPhotoCapture } from "@/components/shared/CounterPhotoCapture";
import { validateFuelEntryValues, type FuelEntryFormValues } from "@/lib/fuel/entry-payload";
import { classifyTicketFuel, ticketAmountMismatch, type TicketExtras } from "@/lib/ocr/ticket-check";
import { toDatetimeLocalValue } from "@/lib/utils/datetime-local";

export type { FuelEntryFormValues } from "@/lib/fuel/entry-payload";

const fmtEuros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const emptyValues = (): FuelEntryFormValues => ({
  // Heure murale du navigateur, pas l'UTC (voir lib/utils/datetime-local.ts).
  occurred_at: toDatetimeLocalValue(),
  totalizer_before: "",
  totalizer_after: "",
  totalizer_before_photo_path: "",
  totalizer_after_photo_path: "",
  vehicle_km: "",
  liters: "",
  unit_price: "",
  station_name: "",
  product: "gazole",
});

function computedLiters(before: string, after: string): number | null {
  const b = Number(before);
  const a = Number(after);
  if (!before || !after || Number.isNaN(b) || Number.isNaN(a) || a <= b) return null;
  return Math.round((a - b) * 100) / 100;
}

/**
 * Shared form for manual entry, OCR pre-fill confirmation, and the
 * manager review queue (Modules 2 & 3) — only the initial values,
 * submit label and callback differ per caller.
 *
 * `showPriceFields` defaults to false: the dominant real case is a
 * fill-up from the company's own cuve, where the driver has no ticket
 * and no idea what the fuel costs — litres comes from the totalizer
 * delta (never re-typed), and the price is filled in server-side from
 * the tank's current PMP (see app/api/fuel-entries, lib/fuel/current-pmp.ts).
 * The wizard passes true only when there's a real station ticket in
 * hand (OCR success or its failure fallback) — that price is real
 * data from a receipt, not something to hide.
 *
 * `station` : achat en station — pas de cuve, donc ni totaliseur ni
 * PMP ; litres, prix au litre (> 0) et produit (gazole / AdBlue) du
 * ticket. `ticket` (total et carburant lus par l'OCR) déclenche les
 * avertissements de cohérence. `onStationChange` affiche la bascule
 * station / cuve (revue d'un ticket rattaché à tort à une cuve).
 */
export function FuelEntryForm({
  initialValues,
  submitLabel,
  busy,
  ocrNotice,
  totalizerOcrEnabled = false,
  showPriceFields = false,
  station = false,
  onStationChange,
  ticket,
  onSubmit,
}: {
  initialValues?: Partial<FuelEntryFormValues>;
  submitLabel: string;
  busy?: boolean;
  ocrNotice?: string;
  /** Offers a "photo du compteur" capture (Claude vision OCR) next to each totalizer field instead of relying on typing alone. */
  totalizerOcrEnabled?: boolean;
  /** Shows litres/prix as driver-editable fields — only when there's a real ticket (OCR or its manual fallback), see above. */
  showPriceFields?: boolean;
  station?: boolean;
  onStationChange?: (station: boolean) => void;
  ticket?: TicketExtras | null;
  onSubmit: (values: FuelEntryFormValues) => void;
}) {
  const ticketProduct = classifyTicketFuel(ticket?.fuel_type);
  const [values, setValues] = useState<FuelEntryFormValues>(() => ({
    ...emptyValues(),
    ...(ticketProduct === "adblue" ? { product: "adblue" as const } : {}),
    ...Object.fromEntries(Object.entries(initialValues ?? {}).filter(([, v]) => v !== undefined && v !== null)),
  }));
  const [formError, setFormError] = useState<string | null>(null);
  // Le rendu serveur (UTC) et le navigateur (Paris) ne calculent pas la
  // même heure locale ; React 18 ne corrige pas la valeur d'un input à
  // l'hydratation, d'où ce remontage du champ date une fois monté.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  function set<K extends keyof FuelEntryFormValues>(key: K, value: FuelEntryFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const derivedLiters = computedLiters(values.totalizer_before, values.totalizer_after);

  const priceFields = station || showPriceFields;
  const mismatch = priceFields ? ticketAmountMismatch(Number(values.liters) || null, Number(values.unit_price) || null, ticket?.total_amount) : null;

  function submit() {
    const invalid = validateFuelEntryValues(values, station);
    setFormError(invalid);
    if (invalid) return;
    onSubmit(derivedLiters !== null && !priceFields ? { ...values, liters: String(derivedLiters) } : values);
  }

  return (
    <Card className="flex flex-col gap-4">
      {ocrNotice && <p className="rounded-lg bg-gold/10 p-3 text-sm text-gold-ink">{ocrNotice}</p>}

      {onStationChange && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={station} onChange={(e) => onStationChange(e.target.checked)} />
          Achat en station (aucune cuve, pas de totaliseur)
        </label>
      )}

      <div>
        <label className="block"><span className="label">Date et heure</span>
        <input
          key={hydrated ? "client" : "server"}
          suppressHydrationWarning
          type="datetime-local"
          className="input"
          value={values.occurred_at}
          onChange={(e) => set("occurred_at", e.target.value)}
        /></label>
      </div>

      {!station && (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block"><span className="label">Index totaliseur avant (L)</span>
          <input
            type="number"
            step="0.01"
            className="input"
            value={values.totalizer_before}
            onChange={(e) => set("totalizer_before", e.target.value)}
          /></label>
          {totalizerOcrEnabled && (
            <div className="mt-1.5">
              <CounterPhotoCapture
                label="Photo compteur avant"
                initUrl="/api/ocr/totalizer/init"
                processUrl="/api/ocr/totalizer/process"
                bucket={process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? "fuel-tickets"}
                onCaptured={({ photoPath, reading }) => {
                  set("totalizer_before_photo_path", photoPath);
                  if (reading !== null) set("totalizer_before", String(reading));
                }}
              />
            </div>
          )}
        </div>
        <div>
          <label className="block"><span className="label">Index totaliseur après (L) *</span>
          <input
            type="number"
            step="0.01"
            className="input"
            value={values.totalizer_after}
            onChange={(e) => set("totalizer_after", e.target.value)}
          /></label>
          {totalizerOcrEnabled && (
            <div className="mt-1.5">
              <CounterPhotoCapture
                label="Photo compteur après"
                initUrl="/api/ocr/totalizer/init"
                processUrl="/api/ocr/totalizer/process"
                bucket={process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ?? "fuel-tickets"}
                onCaptured={({ photoPath, reading }) => {
                  set("totalizer_after_photo_path", photoPath);
                  if (reading !== null) set("totalizer_after", String(reading));
                }}
              />
            </div>
          )}
        </div>
      </div>
      )}

      <div>
        <label className="block"><span className="label">Kilométrage du véhicule</span>
        <input
          type="number"
          step="1"
          className="input"
          value={values.vehicle_km}
          onChange={(e) => set("vehicle_km", e.target.value)}
        /></label>
      </div>

      {priceFields ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block"><span className="label">Litres *</span>
            <input
              type="number"
              step="0.01"
              className="input"
              value={values.liters}
              onChange={(e) => set("liters", e.target.value)}
            /></label>
          </div>
          <div>
            <label className="block"><span className="label">Prix unitaire (€/L) *</span>
            <input
              type="number"
              step="0.0001"
              min="0.0001"
              className="input"
              value={values.unit_price}
              onChange={(e) => set("unit_price", e.target.value)}
            /></label>
          </div>
          {station && (
            <div className="col-span-2">
              <label className="block"><span className="label">Produit *</span>
              <select className="input" value={values.product} onChange={(e) => set("product", e.target.value === "adblue" ? "adblue" : "gazole")}>
                <option value="gazole">Gazole</option>
                <option value="adblue">AdBlue</option>
              </select></label>
            </div>
          )}
        </div>
      ) : (
        derivedLiters !== null && (
          <p className="text-sm text-navy/70">
            Litres (calculés depuis le compteur) : <span className="font-medium text-navy">{derivedLiters} L</span>
          </p>
        )
      )}

      {mismatch && (
        <p role="alert" className="rounded-lg bg-orange/10 p-3 text-sm text-orange-ink">
          Montant incohérent : {values.liters} L × {values.unit_price} €/L = {fmtEuros(mismatch.computed)}, mais le ticket indique{" "}
          {fmtEuros(mismatch.ticket)} (écart {fmtEuros(Math.abs(mismatch.gap))}). Vérifiez les litres et le prix sur le ticket.
        </p>
      )}
      {ticketProduct === "adblue" && values.product !== "adblue" && (
        <p role="alert" className="rounded-lg bg-orange/10 p-3 text-sm text-orange-ink">
          Le ticket indique « {ticket?.fuel_type} » : c&apos;est de l&apos;AdBlue, pas du gazole.
          {station ? " Choisissez le produit AdBlue." : ""}
        </p>
      )}
      {ticketProduct === "essence" && (
        <p role="alert" className="rounded-lg bg-orange/10 p-3 text-sm text-orange-ink">
          Le ticket indique « {ticket?.fuel_type} » (essence) : ni gazole ni AdBlue. Vérifiez qu&apos;il s&apos;agit bien d&apos;un plein de ce véhicule.
        </p>
      )}

      {(station || initialValues?.station_name) && (
        <div>
          <label className="block"><span className="label">Station (optionnel)</span>
          <input className="input" value={values.station_name} onChange={(e) => set("station_name", e.target.value)} /></label>
        </div>
      )}

      {formError && <p role="alert" className="text-sm text-orange-ink">{formError}</p>}

      <button className="btn-primary" disabled={busy} onClick={submit}>
        {busy ? "Enregistrement…" : submitLabel}
      </button>
    </Card>
  );
}
