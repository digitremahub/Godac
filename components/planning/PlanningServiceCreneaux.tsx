"use client";

import { useEffect, useMemo, useState } from "react";

type WindowSlot = { label: string; start: string; end: string };
type ServiceOption = { id: string; name: string };
type ServiceConfig = ServiceOption & { windows: WindowSlot[] };

const DEFAULT_WINDOWS: WindowSlot[] = [
  { label: "8 h – 11 h", start: "08:00", end: "11:00" },
  { label: "10 h – 13 h", start: "10:00", end: "13:00" },
  { label: "12 h – 15 h", start: "12:00", end: "15:00" },
  { label: "14 h – 17 h", start: "14:00", end: "17:00" },
];

export function PlanningServiceCreneaux({ services, selectedService = "" }: { services: ServiceOption[]; selectedService?: string }) {
  const [configs, setConfigs] = useState<ServiceConfig[]>([]);
  const [serviceId, setServiceId] = useState(selectedService || services[0]?.id || "");
  const [windows, setWindows] = useState<WindowSlot[]>(DEFAULT_WINDOWS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const serviceConfigs = useMemo(() => new Map(configs.map((s) => [s.id, s])), [configs]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/colis/creneaux-service?mode=admin")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Impossible de charger les créneaux.");
        if (!cancelled) {
          const next = (data.services ?? []) as ServiceConfig[];
          setConfigs(next);
          const first = next.find((s) => s.id === serviceId && services.some((p) => p.id === s.id)) ?? next.find((s) => services.some((p) => p.id === s.id));
          if (first) {
            setServiceId(first.id);
            setWindows(first.windows?.length ? first.windows : []);
          }
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Erreur de chargement."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // Initial load only: changing services is handled by the next effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const config = serviceConfigs.get(serviceId);
    if (config) setWindows(config.windows ?? []);
  }, [serviceId, serviceConfigs]);

  function update(index: number, fields: Partial<WindowSlot>) {
    setWindows((current) => current.map((w, i) => i === index ? { ...w, ...fields } : w));
    setMessage(null);
  }

  async function save() {
    setSaving(true); setError(null); setMessage(null);
    try {
      const res = await fetch("/api/colis/creneaux-service", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: serviceId, windows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enregistrement impossible.");
      const updated = data.service as ServiceConfig;
      setConfigs((current) => [...current.filter((s) => s.id !== updated.id), updated]);
      setWindows(updated.windows ?? []);
      setMessage("Créneaux enregistrés pour ce service.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d’enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-5 rounded-2xl border border-navy/10 bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold">Créneaux horaires par service</h2>
          <p className="mt-1 max-w-2xl text-sm text-navy/65">
            Définissez les créneaux proposés lors de l’ajout d’un arrêt. Le chauffeur voit les créneaux des services qui lui sont affectés pour la journée.
          </p>
        </div>
        <span className="rounded-full bg-teal/10 px-2 py-1 text-xs font-semibold text-teal-ink">Configuration service</span>
      </div>
      {loading ? <p className="mt-3 text-sm text-navy/60">Chargement…</p> : (
        <>
          <label className="mt-4 flex max-w-md flex-col gap-1 text-sm font-semibold">
            Service
            <select className="input" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setError(null); setMessage(null); }}
              disabled={!services.length}>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="mt-4 flex flex-col gap-2">
            {windows.map((w, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-navy/10 p-3 sm:grid-cols-[minmax(0,1fr)_130px_130px_auto] sm:items-end">
                <label className="flex flex-col gap-1 text-xs text-navy/65">Libellé
                  <input className="input" value={w.label} maxLength={40} onChange={(e) => update(i, { label: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-navy/65">Début
                  <input className="input" type="time" value={w.start} onChange={(e) => update(i, { start: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-navy/65">Fin
                  <input className="input" type="time" value={w.end} onChange={(e) => update(i, { end: e.target.value })} />
                </label>
                <button type="button" className="btn-ghost !py-2 text-sm text-orange-ink" onClick={() => { setWindows((current) => current.filter((_, n) => n !== i)); setMessage(null); }}>
                  Supprimer
                </button>
                {w.start && w.end && w.start >= w.end && <p className="text-xs text-orange-ink sm:col-span-4">La fin doit être après le début.</p>}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={windows.length >= 12} onClick={() => { setWindows((current) => [...current, { label: "Nouveau créneau", start: "08:00", end: "12:00" }]); setMessage(null); }}>
              + Ajouter un créneau
            </button>
            <button type="button" className="btn-primary" disabled={saving || !serviceId || windows.some((w) => !w.label.trim() || !w.start || !w.end || w.start >= w.end) || new Set(windows.map((w) => `${w.start}-${w.end}`)).size !== windows.length} onClick={save}>
              {saving ? "Enregistrement…" : "Enregistrer les créneaux"}
            </button>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-orange-ink">{error}</p>}
          {message && <p role="status" className="mt-3 text-sm font-semibold text-teal-ink">{message}</p>}
        </>
      )}
    </section>
  );
}
