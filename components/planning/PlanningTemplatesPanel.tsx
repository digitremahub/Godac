"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { basculerJour, JOURS_MODELE, JOURS_PAR_DEFAUT, nomModeleParDefaut, raisonGenerationImpossible, resumeJours } from "@/lib/planning/modeles";
import { confirmer } from "@/lib/ui/confirmation";

type ServiceOption = { id: string; name: string };
type RouteOption = { id: string; tourNumber: string; serviceId: string | null };
type VehicleOption = { id: string; registration: string; serviceId: string | null };
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

const DAYS = JOURS_MODELE;

export function PlanningTemplatesPanel({
  services,
  selectedService,
  weekStart,
  routes = [],
  vehicles = [],
}: {
  services: ServiceOption[];
  selectedService: string;
  weekStart: string;
  /** Tournées villages (tour_routes) : un modèle reprend l'une d'elles. */
  routes?: RouteOption[];
  vehicles?: VehicleOption[];
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState(selectedService || services[0]?.id || "");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rechargement, setRechargement] = useState(0);
  // Formulaire « + Nouveau modèle ».
  const [formOuvert, setFormOuvert] = useState(false);
  const [routeId, setRouteId] = useState("");
  const [nom, setNom] = useState("");
  const [depart, setDepart] = useState("07:00");
  const [jours, setJours] = useState<number[]>(JOURS_PAR_DEFAUT);
  const [vehiculeId, setVehiculeId] = useState("");
  const [enregistrement, setEnregistrement] = useState(false);
  const [retrait, setRetrait] = useState<string | null>(null);

  const routesDuService = useMemo(() => routes.filter((r) => r.serviceId === serviceId), [routes, serviceId]);
  const vehiculesDuService = useMemo(() => vehicles.filter((v) => !v.serviceId || v.serviceId === serviceId), [vehicles, serviceId]);

  function ouvrirFormulaire() {
    const premiere = routesDuService[0];
    setRouteId(premiere?.id ?? "");
    setNom(nomModeleParDefaut(premiere?.tourNumber));
    setDepart("07:00");
    setJours(JOURS_PAR_DEFAUT);
    setVehiculeId("");
    setFormOuvert(true);
    setError(null);
    setMessage(null);
  }

  function choisirRoute(id: string) {
    const avant = routesDuService.find((r) => r.id === routeId);
    const apres = routesDuService.find((r) => r.id === id);
    setRouteId(id);
    // Le nom suit la tournée tant qu'il n'a pas été modifié à la main.
    if (!nom.trim() || nom === nomModeleParDefaut(avant?.tourNumber)) setNom(nomModeleParDefaut(apres?.tourNumber));
  }

  async function creerModele(event: React.FormEvent) {
    event.preventDefault();
    if (!serviceId || !routeId || nom.trim().length < 2 || !jours.length) return;
    setEnregistrement(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/planning/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_id: serviceId, route_id: routeId, name: nom.trim(), departure_time: depart, weekdays: jours, default_vehicle_id: vehiculeId || null }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Création de l'affectation récurrente impossible : vérifiez les champs.");
      setMessage(`Affectation récurrente « ${nom.trim()} » créée (${resumeJours(jours)}, départ ${depart}). Cochez-le puis générez la semaine.`);
      setFormOuvert(false);
      setRechargement((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setEnregistrement(false);
    }
  }

  async function retirerModele(template: Template) {
    if (!(await confirmer({ titre: `Retirer l'affectation récurrente « ${template.name} » ?`, message: `Les affectations déjà générées sont conservées.`, action: "Retirer", danger: true }))) return;
    setRetrait(template.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/planning/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Retrait impossible.");
      setTemplates((rows) => rows.filter((row) => row.id !== template.id));
      setSelectedIds((ids) => ids.filter((id) => id !== template.id));
      setMessage(`Affectation récurrente « ${template.name} » retirée.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue.");
    } finally {
      setRetrait(null);
    }
  }

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
      try {
        const response = await fetch(`/api/planning/templates?service_id=${encodeURIComponent(serviceId)}`);
        const json = await response.json();
        if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Impossible de charger les affectations récurrentes.");
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
  }, [serviceId, rechargement]);

  useEffect(() => { setFormOuvert(false); }, [serviceId]);

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

  const raisonGrise = raisonGenerationImpossible({ serviceId, chargement: loading, generation: generating, modeles: templates.length, coches: selectedIds.length });

  return (
    <section className="mb-5 rounded-xl border border-navy/10 bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Préparer la semaine depuis les affectations récurrentes</h2>
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
          {loading ? <p className="py-3 text-sm text-navy/60">Chargement des affectations récurrentes…</p> : templates.length === 0 ? (
            <div className="rounded-lg bg-navy/[0.035] p-3 text-sm text-navy/70">
              Aucune affectation récurrente active pour ce service. Créez-en une avec « + Nouvelle affectation récurrente » : un modèle de tournée, son heure de départ et ses jours. Elle servira ensuite à générer la semaine.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((template) => {
                const route = Array.isArray(template.tour_routes) ? template.tour_routes[0] : template.tour_routes;
                return (
                  <label key={template.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-navy/10 p-3 hover:border-teal/40">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-ink" checked={selectedIds.includes(template.id)} onChange={() => toggleTemplate(template.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{template.name}</span>
                      <span className="mt-0.5 block text-sm text-navy/65">Tournée {route?.tour_number ?? "—"} · départ {template.departure_time.slice(0, 5)}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {DAYS.filter((day) => (template.weekdays ?? []).includes(day.value)).map((day) => (
                          <span key={day.value} className="rounded bg-navy/[0.06] px-1.5 py-0.5 text-xs">{day.label}</span>
                        ))}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 !px-2 !py-1 text-xs"
                      disabled={retrait === template.id}
                      onClick={(event) => { event.preventDefault(); void retirerModele(template); }}
                      aria-label={`Retirer l'affectation récurrente ${template.name}`}
                    >
                      {retrait === template.id ? "Retrait…" : "Retirer"}
                    </button>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4">
        {!formOuvert ? (
          <button type="button" className="btn-secondary" onClick={ouvrirFormulaire} disabled={!serviceId}>+ Nouvelle affectation récurrente</button>
        ) : (
          <form onSubmit={creerModele} className="rounded-lg border border-teal/30 bg-teal/[0.04] p-3">
            <h3 className="text-sm font-semibold">Nouvelle affectation récurrente</h3>
            {routesDuService.length === 0 ? (
              <p className="mt-2 text-sm text-navy/70">Aucun modèle de tournée pour ce service. Créez d’abord le modèle dans « Modèles de tournées & villages », puis revenez ici.</p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-sm font-medium">
                  Tournée
                  <select className="input mt-1 w-full" value={routeId} onChange={(event) => choisirRoute(event.target.value)} required>
                    {routesDuService.map((route) => <option key={route.id} value={route.id}>{route.tourNumber}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium">
                  Nom
                  <input className="input mt-1 w-full" value={nom} onChange={(event) => setNom(event.target.value)} minLength={2} maxLength={80} required />
                </label>
                <label className="block text-sm font-medium">
                  Heure de départ
                  <input className="input mt-1 w-full" type="time" value={depart} onChange={(event) => setDepart(event.target.value)} required />
                </label>
                <label className="block text-sm font-medium">
                  Véhicule par défaut
                  <select className="input mt-1 w-full" value={vehiculeId} onChange={(event) => setVehiculeId(event.target.value)}>
                    <option value="">Aucun (au choix)</option>
                    {vehiculesDuService.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration}</option>)}
                  </select>
                </label>
                <fieldset className="sm:col-span-2 lg:col-span-4">
                  <legend className="text-sm font-medium">Jours <span className="font-normal text-navy/60">({resumeJours(jours)})</span></legend>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {DAYS.map((day) => (
                      <label key={day.value} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${jours.includes(day.value) ? "border-teal bg-teal/10" : "border-navy/15"}`}>
                        <input type="checkbox" className="h-4 w-4 accent-teal-ink" checked={jours.includes(day.value)} onChange={() => setJours((current) => basculerJour(current, day.value))} />
                        {day.label}
                      </label>
                    ))}
                  </div>
                  {!jours.length && <p className="mt-1 text-xs text-orange-ink">Cochez au moins un jour.</p>}
                </fieldset>
              </div>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setFormOuvert(false)} disabled={enregistrement}>Annuler</button>
              <button type="submit" className="btn-primary" disabled={enregistrement || !routeId || nom.trim().length < 2 || !jours.length}>
                {enregistrement ? "Enregistrement…" : "Créer l'affectation récurrente"}
              </button>
            </div>
          </form>
        )}
      </div>

      {error && <p role="alert" className="mt-3 rounded-lg bg-orange/10 p-3 text-sm text-orange-ink">{error}</p>}
      {message && <p role="status" className="mt-3 rounded-lg bg-teal/10 p-3 text-sm text-teal-ink">{message}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-navy/60">La génération crée des affectations prévues, sans chauffeur (à attribuer ensuite dans la grille). Elle ne remplace pas les affectations existantes et ne publie pas le planning.</p>
        <div className="flex flex-col items-end gap-1">
          <button type="button" className="btn-primary" onClick={generate} disabled={loading || generating || !serviceId || selectedIds.length === 0} aria-describedby={raisonGrise ? "raison-generation" : undefined} title={raisonGrise ?? undefined}>
            {generating ? "Génération…" : `Générer ${selectedIds.length} affectation(s) récurrente(s)`}
          </button>
          {raisonGrise && <p id="raison-generation" className="text-xs text-navy/60">{raisonGrise}</p>}
        </div>
      </div>
    </section>
  );
}
