"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { IconCamera, IconX } from "@/components/layout/icons";

interface VehicleOption {
  id: string;
  registration: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  mechanical: "Problème mécanique",
  bodywork: "Carrosserie",
  tires: "Pneumatiques",
  maintenance: "Entretien / révision",
  other: "Autre",
};

const URGENCY_LABELS: Record<string, string> = {
  low: "Faible",
  normal: "Normale",
  high: "Haute",
  critical: "Critique",
};

const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function MaintenanceRequestForm({
  vehicles,
  initialVehicleId,
  emergencyPhone,
}: {
  vehicles: VehicleOption[];
  initialVehicleId?: string;
  emergencyPhone?: string | null;
}) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [vehicleId, setVehicleId] = useState(initialVehicleId ?? vehicles[0]?.id ?? "");
  const [category, setCategory] = useState("mechanical");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [odometerKm, setOdometerKm] = useState("");
  const [appointmentNeeded, setAppointmentNeeded] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(null);
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      if (photos.length + accepted.length >= MAX_PHOTOS) break;
      if (file.type && !ALLOWED_PHOTO_TYPES.includes(file.type)) {
        setError("Formats acceptés : JPEG, PNG, WebP, HEIC.");
        continue;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setError("Chaque photo doit faire moins de 8 Mo.");
        continue;
      }
      accepted.push(file);
    }
    setPhotos((prev) => [...prev, ...accepted].slice(0, MAX_PHOTOS));
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const res = await fetch("/api/vehicle-interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          category,
          description: description || undefined,
          urgency,
          odometer_km: odometerKm ? Number(odometerKm) : undefined,
          appointment_needed: appointmentNeeded,
          photo_count: photos.length,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");

      const { photoPaths } = json as { photoPaths: string[] };
      for (let i = 0; i < photos.length; i++) {
        const path = photoPaths[i];
        const file = photos[i];
        if (!path || !file) continue;
        const { error: uploadError } = await supabase.storage
          .from("intervention-photos")
          .upload(path, file, { contentType: file.type || "image/jpeg" });
        if (uploadError) throw new Error(`Envoi d'une photo échoué: ${uploadError.message}`);
      }

      setDescription("");
      setUrgency("normal");
      setOdometerKm("");
      setAppointmentNeeded(false);
      setPhotos([]);
      setSent(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (vehicles.length === 0) {
    return <Card className="text-sm text-navy/65">Aucun véhicule disponible pour ouvrir une demande.</Card>;
  }

  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg">Nouvelle demande d&apos;entretien</h3>

      {emergencyPhone && (
        <p className="rounded-lg bg-orange-ink/10 p-3 text-sm text-orange-ink">
          En cas d&apos;accident, appelez immédiatement le responsable :{" "}
          <a href={`tel:${emergencyPhone}`} className="font-semibold underline">
            {emergencyPhone}
          </a>
        </p>
      )}

      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {sent && <p role="status" className="text-sm text-teal-ink">Demande envoyée.</p>}

      <div>
        <label className="block"><span className="label">Véhicule</span>
        <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration}
            </option>
          ))}
        </select></label>
      </div>

      <div>
        <label className="block"><span className="label">Type de problème</span>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select></label>
      </div>

      <div>
        <label className="block"><span className="label">Urgence</span>
        <select className="input" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          {Object.entries(URGENCY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select></label>
      </div>

      <div>
        <label className="block"><span className="label">Description (optionnel)</span>
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      </div>

      <div>
        <label className="block"><span className="label">Kilométrage (optionnel)</span>
        <input className="input" type="number" value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} /></label>
      </div>

      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" checked={appointmentNeeded} onChange={(e) => setAppointmentNeeded(e.target.checked)} />
        Un rendez-vous au garage est à prévoir
      </label>

      <div className="flex flex-col gap-2">
        <p className="label">Photos (optionnel, {photos.length}/{MAX_PHOTOS})</p>
        {photos.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {photos.map((file, i) => (
              <li key={i} className="flex items-center gap-1 rounded-lg bg-navy/[0.04] px-2 py-1 text-xs">
                {file.name}
                <button type="button" className="text-orange-ink" onClick={() => removePhoto(i)} aria-label={`Retirer ${file.name}`}>
                  <IconX className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length < MAX_PHOTOS && (
          <label className="btn-secondary w-full cursor-pointer justify-center text-center">
            <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Ajouter une photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(e) => addPhotos(e.target.files)}
            />
          </label>
        )}
      </div>

      <button className="btn-primary w-full justify-center text-base" disabled={busy || !vehicleId} onClick={submit}>
        {busy ? "Envoi…" : "Envoyer la demande"}
      </button>
    </Card>
  );
}
