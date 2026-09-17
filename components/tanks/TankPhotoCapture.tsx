"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/**
 * Lets any driver document a tank's totalizer with a photo, no OCR
 * involved — unlike a fuel ticket, nobody tries to auto-extract this,
 * it just needs a manager-like/direction user to read and confirm the
 * value later from /tanks/photos (see app/api/tank-photos/route.ts).
 */
export function TankPhotoCapture({ tankId }: { tankId: string }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [capturing, setCapturing] = useState(false);
  const [reading, setReading] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const initRes = await fetch("/api/tank-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tank_id: tankId, totalizer_reading: reading ? Number(reading) : undefined }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(initJson.error?.message ?? JSON.stringify(initJson.error) ?? "Erreur");

      const { storagePath } = initJson as { storagePath: string };
      const { error: uploadError } = await supabase.storage
        .from("tank-photos")
        .upload(storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué: ${uploadError.message}`);

      setSent(true);
      setCapturing(false);
      setReading("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (!capturing) {
    return (
      <button className="btn-secondary w-full" onClick={() => setCapturing(true)}>
        📷 Photo de l&apos;index
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {error && <p className="text-xs text-orange-ink">{error}</p>}
      {sent && <p className="text-xs text-teal-ink">Photo envoyée, en attente de vérification.</p>}
      <input
        className="input !py-1 text-sm"
        type="number"
        placeholder="Index lu (optionnel)"
        value={reading}
        onChange={(e) => setReading(e.target.value)}
      />
      <label className="btn-primary w-full cursor-pointer justify-center text-center !py-1.5 text-sm">
        {busy ? "Envoi…" : "Prendre la photo"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={busy}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </label>
      <button className="text-xs text-navy/40 hover:text-navy/70" onClick={() => setCapturing(false)} disabled={busy}>
        Annuler
      </button>
    </div>
  );
}
