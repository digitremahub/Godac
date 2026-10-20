"use client";

import { useEffect, useState } from "react";
import { ChoixRegroupement, lireChoixRequis, type ChoixRegroupementData } from "@/components/colis/ChoixRegroupement";
import type { Regroupement } from "@/lib/colis/fiches-affectation";

type Option = { id: string; name?: string; full_name?: string; registration?: string; service_id?: string };
type TourOption = { id: string; tour_number: string; service_id: string | null };
type Data = { services: Option[]; drivers: Option[]; vehicles: Option[]; tours: TourOption[]; today: string };

export function AffecterTournee({ onClose, onCreated }: { onClose: () => void; onCreated: (runId: string | null, message: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [service, setService] = useState("");
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [choix, setChoix] = useState<ChoixRegroupementData | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/colis/affectations").then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Chargement impossible");
      if (active) { setData(d); setDate(d.today); }
    }).catch((e) => { if (active) setMessage(e instanceof Error ? e.message : "Chargement impossible"); });
    return () => { active = false; };
  }, []);

  // Changer de chauffeur, date, heure ou tournée annule la question en cours.
  useEffect(() => { setChoix(null); }, [service, driver, vehicle, date, time, number]);

  async function submit(regroupement?: Regroupement) {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/colis/affectations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: service, driver_id: driver, vehicle_id: vehicle, tour_number: number, date, time, ...(regroupement ? { regroupement } : {}) }),
      });
      const d = await r.json();
      // Le chauffeur a déjà une tournée ce jour-là : séparées ou reliées ?
      const question = lireChoixRequis(r.status, d);
      if (question) { setChoix(question); return; }
      setChoix(null);
      if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : "Création impossible");
      // Affectation = planning + fiche Tournée colis du chauffeur (créée ou complétée).
      const nom = data?.drivers.find((x) => x.id === driver)?.full_name ?? "le chauffeur";
      const avertissement = typeof d.warning === "string" && d.warning ? ` ${d.warning}` : "";
      onCreated(d.fiche?.id ?? null, d.fiche?.id ? `Tournée n°${number} affectée à ${nom} : sa fiche colis est prête.${avertissement}` : `Tournée n°${number} inscrite au planning de ${nom}.${avertissement}`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Création impossible"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-navy/55 p-3 sm:p-6" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="creer-tournee-direction" className="my-auto w-full max-w-3xl rounded-2xl border border-teal/30 bg-white p-5 shadow-2xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h2 id="creer-tournee-direction" className="text-lg font-semibold">Créer une tournée colis</h2>
            <p className="mt-1 text-sm text-navy/65">Choisissez le service, la tournée habituelle, le chauffeur et le véhicule. La tournée est inscrite au planning et la fiche Tournée colis du chauffeur est préparée (villages, ramasses, points relais). Un chauffeur peut avoir plusieurs tournées dans la journée : chacune a sa fiche, sauf si vous choisissez de les relier.</p>
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1" disabled={busy} onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {!data ? <p className="py-6 text-sm text-navy/60">{message || "Chargement des services et tournées…"}</p> : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm">Service
                <select className="input mt-1" value={service} onChange={(e) => { setService(e.target.value); setVehicle(""); setNumber(""); }}>
                  <option value="">Choisir…</option>{data.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="text-sm">Tournée existante
                <select className="input mt-1" value={number} onChange={(e) => setNumber(e.target.value)}>
                  <option value="">Choisir une tournée…</option>{data.tours.filter((t) => Boolean(service) && t.service_id === service).map((t) => <option key={t.id} value={t.tour_number}>{t.tour_number}</option>)}
                </select>
              </label>
              <label className="text-sm">Chauffeur
                <select className="input mt-1" value={driver} onChange={(e) => setDriver(e.target.value)}>
                  <option value="">Choisir…</option>{data.drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </label>
              <label className="text-sm">Véhicule
                <select className="input mt-1" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                  <option value="">Choisir…</option>{data.vehicles.filter((v) => !service || v.service_id === service).map((v) => <option key={v.id} value={v.id}>{v.registration}</option>)}
                </select>
              </label>
              <label className="text-sm">Date<input className="input mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label className="text-sm">Heure de départ<input className="input mt-1" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
            </div>
            {message && <p role="status" className="mt-3 rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">{message}</p>}
            {choix && <ChoixRegroupement choix={choix} busy={busy} onChoisir={(r) => submit(r)} onAnnuler={() => setChoix(null)} />}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Annuler</button>
              <button type="button" className="btn-primary" disabled={busy || Boolean(choix) || !service || !number || !driver || !vehicle || !date || !time} onClick={() => submit()}>{busy ? "Création…" : "Créer et charger la tournée"}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
