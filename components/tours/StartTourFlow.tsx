"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { QrScanner } from "@/components/fuel/QrScanner";
import { Card, EmptyState } from "@/components/ui";

interface OpenTour {
  id: string;
  tour_number: string;
  start_at: string;
  vehicles: { id: string; registration: string } | null;
}

/**
 * Départ de tournée: scan véhicule → numéro de tournée + kilométrage
 * → photo de la feuille papier. Départ/heure sont pris automatiquement
 * au moment de l'envoi (start_at), pas de saisie manuelle nécessaire.
 */
export function StartTourFlow() {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [openTour, setOpenTour] = useState<OpenTour | null>(null);
  const [tourNumber, setTourNumber] = useState("");
  const [startKm, setStartKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleScan(id: string) {
    setVehicleId(id);
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/tours/open");
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setOpenTour(json.tour);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setChecking(false);
    }
  }

  async function handlePhoto(file: File) {
    if (!vehicleId || !tourNumber) return;
    setBusy(true);
    setError(null);
    try {
      const initRes = await fetch("/api/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicle_id: vehicleId,
          tour_number: tourNumber,
          start_km: startKm ? Number(startKm) : undefined,
        }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(typeof initJson.error === "string" ? initJson.error : "Erreur");

      const { storagePath } = initJson as { storagePath: string };
      const { error: uploadError } = await supabase.storage
        .from("tour-photos")
        .upload(storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué: ${uploadError.message}`);

      setDone(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <EmptyState title="Tournée démarrée" description="Le départ a été enregistré. Bonne route !" />;
  }

  if (!vehicleId) {
    return <QrScanner expected="vehicle" label="Scannez le QR du véhicule" onScan={(p) => handleScan(p.id)} />;
  }

  if (checking) {
    return <p className="text-sm text-navy/60">Vérification…</p>;
  }

  if (openTour) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-orange-ink">
          Vous avez déjà une tournée en cours (n°{openTour.tour_number}
          {openTour.vehicles ? ` — ${openTour.vehicles.registration}` : ""}, depuis{" "}
          {new Date(openTour.start_at).toLocaleTimeString("fr-FR")}).
        </p>
        <Link href="/tours/end" className="btn-primary text-center">
          Terminer cette tournée
        </Link>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      <div>
        <label className="label">Numéro de tournée</label>
        <input
          className="input"
          value={tourNumber}
          onChange={(e) => setTourNumber(e.target.value)}
          placeholder="ex: T-042"
        />
      </div>
      <div>
        <label className="label">Kilométrage au départ</label>
        <input className="input" type="number" value={startKm} onChange={(e) => setStartKm(e.target.value)} />
      </div>
      <label
        className={`btn-primary w-full cursor-pointer justify-center text-center ${
          !tourNumber || busy ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {busy ? "Envoi…" : "📷 Photo de la feuille de départ"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={busy || !tourNumber}
          onChange={(e) => e.target.files?.[0] && handlePhoto(e.target.files[0])}
        />
      </label>
    </Card>
  );
}
