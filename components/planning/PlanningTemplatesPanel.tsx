"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ServiceOption = { id: string; name: string };
type Template = {
  id: string;
  service_id: string;
  route_id: string;
  name: string;
  departure_time: string;
  weekdays: number[];
  default_vehicle_id: string | null;
  services?: { name: string } | null;
  tour_routes?: {
    tour_number: string;
    notes: string | null;
    tour_route_villages?: { id: string; name: string; postal_code: string | null; position: number }[];
  } | null;
};

const DAYS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
  { value: 0, label: "Dim" },
];

export function PlanningTemplatesPanel({
  services,
  selectedService,
  weekStart,
}: {
  services: ServiceOption[];
  selectedService: string;
  weekStart: string;
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState(selectedService || services[0]?.id || "");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setServiceId(selectedService || services[0]?.id || "");
  }, [selectedService, services]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!serviceId) {
        setTemplates([]);
        setSelectedIds([]);
        return;
      }
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const response = await fetch(`/api/planning/templates?service_id=${encodeURIComponent(serviceId)}`);
        const json = await response.json();
        if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Impossible de charger les modèles.");
        if (cancelled) return;
        const rows = Array.isArray(json.templates) ? json.templates as Template[] : [];
        setTemplates(rows);
        setSelectedIds(rows.map((row) => row.id));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur de chargement.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [serviceId]);

  const weekLabel = useMemo(() => {
    const end = new Date(`${weekStart}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const fmt = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
    return `${fmt(weekStart)} au ${fmt(end.toISOString().slice(0, 10))}`;
  }, [weekStart]);

  function toggleTemplate(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setMessage(null);
  }

  async function generate() {
    if (!serviceId || selectedIds.length === 0) return;
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/planning/templates/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week_start: weekStart, service_id: serviceId, template_ids: selectedIds }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "La génération a échoué.");
      setMessage(`${json.created ?? 0} affectation(s) créée(s), ${json.skipped ?? 0} créneau(x) déjà présent(s) ignoré(s).`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="mb-5 rounded-xl border border-navy/10 bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Préparer la semaine depuis les modèles</h2>
          <p className="mt-1 text-sm text-navy/65">Semaine du {weekLabel}. Cochez les tournées récurrentes à créer ; les créneaux déjà présents sont conservés.</p>
        </div>
        <span className="rounded-full bg-teal/10 px-3 py-1 text-xs font-semibold text-teal-ink">Réutilisation</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(180px,240px)_1fr]">
        <label className="block text-sm font-medium">
          Service
          <select className="input mt-1 w-full" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
            {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select>
        </label>

        <div className="min-w-0">
          {loading ? <p className="py-3 text-sm text-navy/60">Chargement des modèles…</p> : templates.length === 0 ? (
            <div className="rounded-lg bg-navy/[0.035] p-3 text-sm text-navy/70">
              Aucun modèle actif pour ce service. Créez d’abord un modèle à partir d’une fiche tournée existante.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((template) => {
                const route = Array.isArray(template.tour_routes) ? template.tour_routes[0] : template.tour_routes;
                return (
                  <label key={template.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-navy/10 p-3 hover:border-teal/40">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-ink" checked={selectedIds.includes(template.id)} onChange={() => toggleTemplate(template.id)} />
                    <span className="min-w-0">
                      <span className="block font-medium">{template.name}</span>
                      <span className="mt-0.5 block text-sm text-navy/65">Tournée {route?.tour_number ?? "—"} · départ {template.departure_time.slice(0, 5)}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {DAYS.filter((day) => (template.weekdays ?? []).includes(day.value)).map((day) => (
                          <span key={day.value} className="rounded bg-navy/[0.06] px-1.5 py-0.5 text-xs">{day.label}</span>
                        ))}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="mt-3 rounded-lg bg-teal/10 p-3 text-sm text-teal-ink">{message}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-navy/60">La génération crée des affectations prévues. Elle ne remplace pas les affectations existantes et ne publie pas le planning.</p>
        <button type="button" className="btn-primary" onClick={generate} disabled={loading || generating || !serviceId || selectedIds.length === 0}>
          {generating ? "Génération…" : `Générer ${selectedIds.length} modèle(s)`}
        </button>
      </div>
    </section>
  );
}
