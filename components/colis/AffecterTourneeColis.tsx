"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name: string };
type Driver = { id: string; full_name: string };
type Vehicle = { id: string; registration: string; service_id: string | null };

export function AffecterTourneeColis({ services, drivers, vehicles }: { services: Option[]; drivers: Driver[]; vehicles: Vehicle[] }) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date()));
  const [time, setTime] = useState("07:00");
  const [tourNumber, setTourNumber] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const filteredVehicles = vehicles.filter(v => !v.service_id || v.service_id === serviceId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/colis/affectations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: serviceId, driver_id: driverId, vehicle_id: vehicleId, date, time, tour_number: tourNumber }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Affectation impossible.");
      setMessage({ ok: true, text: typeof json.warning === "string" ? json.warning : "Tournée ajoutée au planning. Le chauffeur retrouvera les tournées planifiées dans sa fiche quotidienne Tournée colis." });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Erreur inattendue." });
    } finally {
      setBusy(false);
    }
  }

  return <section className="mb-5 rounded-2xl border border-navy/10 bg-surface p-4">
    <h2 className="text-base font-semibold text-navy">Affecter une tournée existante</h2>
    <p className="mt-1 text-sm text-navy/65">Le numéro doit correspondre à un modèle enregistré dans « Tournées villages ». Cette action inscrit la tournée au planning. Le chauffeur crée ensuite sa fiche quotidienne, qui regroupe ses tournées planifiées et leurs arrêts.</p>
    <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm font-medium">Service<select className="input mt-1 w-full" value={serviceId} onChange={e => { setServiceId(e.target.value); setVehicleId(""); }} required>
        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      <label className="text-sm font-medium">Chauffeur<select className="input mt-1 w-full" value={driverId} onChange={e => setDriverId(e.target.value)} required>
        <option value="">Choisir un chauffeur</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
      </select></label>
      <label className="text-sm font-medium">Véhicule<select className="input mt-1 w-full" value={vehicleId} onChange={e => setVehicleId(e.target.value)} required>
        <option value="">Choisir un véhicule</option>{filteredVehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}
      </select></label>
      <label className="text-sm font-medium">Date<input className="input mt-1 w-full" type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
      <label className="text-sm font-medium">Heure de départ<input className="input mt-1 w-full" type="time" value={time} onChange={e => setTime(e.target.value)} required /></label>
      <label className="text-sm font-medium">Numéro de tournée<input className="input mt-1 w-full" value={tourNumber} onChange={e => setTourNumber(e.target.value)} required maxLength={40} /></label>
      <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary" type="submit" disabled={busy || !serviceId || !driverId || !vehicleId || !tourNumber.trim()}>{busy ? "Affectation…" : "Créer et affecter la tournée"}</button>
        {message && <p role="status" className={message.ok ? "text-sm text-teal-700" : "text-sm text-red-700"}>{message.text}</p>}
      </div>
    </form>
  </section>;
}
