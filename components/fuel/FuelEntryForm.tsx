"use client";

import { useState } from "react";
import { Card } from "@/components/ui";

export interface FuelEntryFormValues {
  occurred_at: string;
  totalizer_before: string;
  totalizer_after: string;
  liters: string;
  unit_price: string;
  station_name: string;
}

const EMPTY_VALUES: FuelEntryFormValues = {
  occurred_at: new Date().toISOString().slice(0, 16),
  totalizer_before: "",
  totalizer_after: "",
  liters: "",
  unit_price: "",
  station_name: "",
};

/**
 * Shared form for manual entry, OCR pre-fill confirmation, and the
 * manager review queue (Modules 2 & 3) — only the initial values,
 * submit label and callback differ per caller.
 */
export function FuelEntryForm({
  initialValues,
  submitLabel,
  busy,
  ocrNotice,
  onSubmit,
}: {
  initialValues?: Partial<FuelEntryFormValues>;
  submitLabel: string;
  busy?: boolean;
  ocrNotice?: string;
  onSubmit: (values: FuelEntryFormValues) => void;
}) {
  const [values, setValues] = useState<FuelEntryFormValues>({ ...EMPTY_VALUES, ...initialValues });

  function set<K extends keyof FuelEntryFormValues>(key: K, value: FuelEntryFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <Card className="flex flex-col gap-4">
      {ocrNotice && <p className="rounded-lg bg-gold/10 p-3 text-sm text-gold">{ocrNotice}</p>}

      <div>
        <label className="label">Date et heure</label>
        <input
          type="datetime-local"
          className="input"
          value={values.occurred_at}
          onChange={(e) => set("occurred_at", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Index totaliseur avant (L)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={values.totalizer_before}
            onChange={(e) => set("totalizer_before", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Index totaliseur après (L) *</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={values.totalizer_after}
            onChange={(e) => set("totalizer_after", e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Litres *</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={values.liters}
            onChange={(e) => set("liters", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Prix unitaire (€/L) *</label>
          <input
            type="number"
            step="0.0001"
            className="input"
            value={values.unit_price}
            onChange={(e) => set("unit_price", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label">Station (optionnel)</label>
        <input
          className="input"
          value={values.station_name}
          onChange={(e) => set("station_name", e.target.value)}
        />
      </div>

      <button className="btn-primary" disabled={busy} onClick={() => onSubmit(values)}>
        {busy ? "Enregistrement…" : submitLabel}
      </button>
    </Card>
  );
}
