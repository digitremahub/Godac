"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; name?: string; full_name?: string; registration?: string; service_id?: string };
type TourOption = { id: string; tour_number: string; service_id: string | null };
type Data = { services: Option[]; drivers: Option[]; vehicles: Option[]; tours: TourOption[]; today: string };
export function AffecterTournee() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [service, setService] = useState("");
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/colis/affectations").then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Chargement impossible");
      setData(d); setDate(d.today);
    }).catch(e => setMessage(e instanceof Error ? e.message : "Chargement impossible"));
  }, []);
  async function submit() {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/colis/affectations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service_id: service, driver_id: driver, vehicle_id: vehicle, tour_number: number, date, time }) });
      const d = await r.json();
      if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : "Affectation impossible");
      setMessage(d.pickupWarning || d.warning || "Tournée existante affectée : elle apparaît dans le Planning et chez le chauffeur dans Tournée colis.");
      setNumber(""); router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Affectation impossible"); }
    finally { setBusy(false); }
  }
  if (!data) return message ? <p className="mb-4 text-sm text-orange-ink">{message}</p> : null;
  return <section className="mb-5 rounded-xl border border-teal/25 bg-surface p-4">
    <h2 className="font-semibold">Affecter une tournée</h2>
    <p className="mb-3 mt-1 text-sm text-navy/65">Sélectionnez une tournée existante. L’affectation datée relie le chauffeur à cette tournée sans modifier son modèle.</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">Service<select className="input mt-1" value={service} onChange={e => { setService(e.target.value); setVehicle(""); }}><option value="">Choisir…</option>{data.services.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="text-sm">Chauffeur<select className="input mt-1" value={driver} onChange={e=>setDriver(e.target.value)}><option value="">Choisir…</option>{data.drivers.map(d=><option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label>
      <label className="text-sm">Véhicule<select className="input mt-1" value={vehicle} onChange={e=>setVehicle(e.target.value)}><option value="">Choisir…</option>{data.vehicles.filter(v=>!service||v.service_id===service).map(v=><option key={v.id} value={v.id}>{v.registration}</option>)}</select></label>
      <label className="text-sm">Date<input className="input mt-1" type="date" value={date} onChange={e=>setDate(e.target.value)} /></label>
      <label className="text-sm">Heure de départ<input className="input mt-1" type="time" value={time} onChange={e=>setTime(e.target.value)} /></label>
      <label className="text-sm">Tournée existante<select className="input mt-1" value={number} onChange={e=>setNumber(e.target.value)}><option value="">Choisir une tournée…</option>{data.tours.filter(t=>!t.service_id||!service||t.service_id===service).map(t=><option key={t.id} value={t.tour_number}>{t.tour_number}</option>)}</select></label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" className="btn-primary" disabled={busy||!service||!driver||!vehicle||!date||!time||!number.trim()} onClick={submit}>{busy?"Affectation…":"Affecter la tournée"}</button>{message&&<p className="text-sm" role="status">{message}</p>}</div>
  </section>;
}
