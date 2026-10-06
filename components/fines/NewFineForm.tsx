"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { FinePhotoCapture } from "@/components/fines/FinePhotoCapture";

interface VehicleOption {
  id: string;
  registration: string;
}

export function NewFineForm({ vehicles }: { vehicles: VehicleOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [photoPath, setPhotoPath] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [readNotice, setReadNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhotoPath("");
    setVehicleId("");
    setDate("");
    setTime("");
    setAmount("");
    setReference("");
    setReadNotice(null);
    setError(null);
  }

  async function submit() {
    if (!vehicleId || !date || !time || !amount) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          infraction_date: date,
          infraction_time: time,
          amount: Number(amount),
          reference: reference || undefined,
          photo_path: photoPath || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setOpen(false);
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        + Nouvelle amende
      </button>
    );
  }

  return (
    <Card className="mb-4 flex flex-col gap-3">
      <FinePhotoCapture
        onCaptured={({ photoPath: path, fields, vehicleId: matchedVehicleId }) => {
          setPhotoPath(path);
          if (fields) {
            if (matchedVehicleId) setVehicleId(matchedVehicleId);
            if (fields.infraction_date) setDate(fields.infraction_date);
            if (fields.infraction_time) setTime(fields.infraction_time);
            if (fields.amount !== null) setAmount(String(fields.amount));
            if (fields.reference) setReference(fields.reference);
            setReadNotice(
              [
                fields.registration && !matchedVehicleId ? `plaque "${fields.registration}" non reconnue dans la flotte` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Champs pré-remplis automatiquement — vérifiez avant d'enregistrer.",
            );
          }
        }}
      />
      {readNotice && <p className="text-xs text-gold-ink">{readNotice}</p>}
      {error && <p className="text-sm text-orange-ink">{error}</p>}

      <div>
        <label className="label">Véhicule</label>
        <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">Choisir…</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="label">Date de l&apos;infraction</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="label">Heure</label>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="label">Montant (€)</label>
          <input className="input" type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="label">Référence (optionnel)</label>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={busy || !vehicleId || !date || !time || !amount}
          onClick={submit}
        >
          {busy ? "Enregistrement…" : "Enregistrer l'amende"}
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setOpen(false);
            reset();
          }}
        >
          Annuler
        </button>
      </div>
    </Card>
  );
}
