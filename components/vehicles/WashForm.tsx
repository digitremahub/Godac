"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui";
import type { VehicleType } from "@/lib/types/domain";

export function WashForm({ vehicleId, vehicleType }: { vehicleId: string; vehicleType: VehicleType }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [exterior, setExterior] = useState(false);
  const [cabin, setCabin] = useState(false);
  const [trailer, setTrailer] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const atLeastOne = exterior || cabin || trailer;

  async function submit() {
    if (!atLeastOne) {
      setError("Cochez au moins une case.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vehicle-washes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          washed_exterior: exterior,
          washed_cabin_interior: cabin,
          washed_trailer: trailer,
          has_photo: Boolean(photo),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");

      if (photo && json.storagePath) {
        const { error: uploadError } = await supabase.storage
          .from("tour-photos")
          .upload(json.storagePath, photo, { contentType: photo.type });
        if (uploadError) throw new Error(`Envoi de la photo échoué: ${uploadError.message}`);
      }

      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-lg">🧽 Lavage enregistré</p>
        <button className="btn-secondary mt-2" onClick={() => router.refresh()}>
          OK
        </button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      <div className="flex flex-col gap-2">
        <label className="flex min-h-[44px] items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={exterior} onChange={(e) => setExterior(e.target.checked)} />
          Extérieur
        </label>
        <label className="flex min-h-[44px] items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={cabin} onChange={(e) => setCabin(e.target.checked)} />
          Intérieur cabine
        </label>
        {vehicleType === "SPL" && (
          <label className="flex min-h-[44px] items-center gap-2.5 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={trailer} onChange={(e) => setTrailer(e.target.checked)} />
            Semi-remorque
          </label>
        )}
      </div>
      <label className="btn-secondary w-full cursor-pointer justify-center text-center">
        {photo ? "📷 Photo ajoutée" : "📷 Photo (optionnel)"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
      </label>
      <button className="btn-primary w-full" disabled={busy || !atLeastOne} onClick={submit}>
        {busy ? "Envoi…" : "Enregistrer le lavage"}
      </button>
    </Card>
  );
}
