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
  const [lieu, setLieu] = useState("");
  const [montantMinore, setMontantMinore] = useState("");
  const [dateLimite, setDateLimite] = useState("");
  const [resultat, setResultat] = useState<string | null>(null);
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
    setLieu("");
    setMontantMinore("");
    setDateLimite("");
    setReadNotice(null);
    setError(null);
  }

  async function submit() {
    if (!photoPath || !vehicleId || !date || !time || !amount) return;
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
          photo_path: photoPath,
          location: lieu.trim() || null,
          reduced_amount: montantMinore === "" ? null : Number(montantMinore),
          payment_deadline: dateLimite || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setResultat(
        json.suggestedDriver
          ? `Amende enregistrée. Responsable suggéré (${json.confiance === "exact" ? "exact" : "probable"}) : ${json.suggestedDriver.name}${json.suggestedDriver.tourNumber ? `, tournée n°${json.suggestedDriver.tourNumber}` : ""} — à valider.`
          : `Amende enregistrée. ${json.raison ?? "Aucun chauffeur trouvé au planning"} Choisissez le responsable dans la fiche.`,
      );
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
      <div className="flex flex-col items-start gap-2">
        <button className="btn-primary" onClick={() => { setResultat(null); setOpen(true); }}>
          + Nouvelle amende
        </button>
        {resultat && <p role="status" className="text-sm text-teal-ink">{resultat}</p>}
      </div>
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
            if (fields.location) setLieu(fields.location);
            if (fields.reduced_amount !== null) setMontantMinore(String(fields.reduced_amount));
            if (fields.payment_deadline) setDateLimite(fields.payment_deadline);
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
      {!photoPath && <p className="text-xs text-navy/60">La photo ou le PDF de l&apos;avis est obligatoire avant l&apos;enregistrement.</p>}
      {readNotice && <p className="text-xs text-gold-ink">{readNotice}</p>}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      <div>
        <label className="block"><span className="label">Véhicule</span>
        <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">Choisir…</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration}
            </option>
          ))}
        </select></label>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block"><span className="label">Date de l&apos;infraction</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        <div className="flex-1">
          <label className="block"><span className="label">Heure</span>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block"><span className="label">Montant (€)</span>
          <input className="input" type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <div className="flex-1">
          <label className="block"><span className="label">N° d&apos;avis</span>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        </div>
      </div>
      <label className="block"><span className="label">Lieu de l&apos;infraction</span>
      <input className="input" value={lieu} onChange={(e) => setLieu(e.target.value)} /></label>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block"><span className="label">Montant minoré (€)</span>
          <input className="input" type="number" min={0} step={0.01} value={montantMinore} onChange={(e) => setMontantMinore(e.target.value)} /></label>
        </div>
        <div className="flex-1">
          <label className="block"><span className="label">À régler avant le</span>
          <input className="input" type="date" value={dateLimite} onChange={(e) => setDateLimite(e.target.value)} /></label>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={busy || !photoPath || !vehicleId || !date || !time || !amount}
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
