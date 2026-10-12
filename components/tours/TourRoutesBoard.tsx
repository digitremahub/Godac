"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { IconMapPin } from "@/components/layout/icons";
import { networkErrorMessage } from "@/lib/utils/network-error";

export interface Village {
  name: string;
  postal_code: string | null;
  notes: string | null;
}

export interface TourRoute {
  id: string;
  tourNumber: string;
  serviceId: string | null;
  serviceName: string | null;
  notes: string | null;
  villages: Village[];
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible");
  return json;
}

const mapsLink = (v: Village) => `https://www.google.com/maps?q=${encodeURIComponent([v.name, v.postal_code, "France"].filter(Boolean).join(" "))}`;

function RouteCard({ route, canEdit, services }: { route: TourRoute; canEdit: boolean; services: { id: string; name: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [villages, setVillages] = useState<Village[]>(route.villages);
  const [notes, setNotes] = useState(route.notes ?? "");
  const [serviceId, setServiceId] = useState(route.serviceId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(i: number, patch: Partial<Village>) {
    setVillages(villages.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  }
  function move(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= villages.length) return;
    const next = [...villages];
    const [moved] = next.splice(i, 1);
    if (moved) next.splice(j, 0, moved);
    setVillages(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/tour-routes/${route.id}`, "PATCH", { notes: notes.trim() || null, service_id: serviceId || null });
      await send(`/api/tour-routes/${route.id}/villages`, "PUT", {
        villages: villages.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), postal_code: v.postal_code?.trim() || null, notes: v.notes?.trim() || null })),
      });
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Supprimer la fiche de la tournée ${route.tourNumber} et ses villages ?`)) return;
    setBusy(true);
    try {
      await send(`/api/tour-routes/${route.id}`, "DELETE");
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg tabular-nums">Tournée {route.tourNumber}</h2>
          <p className="text-sm text-navy/60">
            {route.serviceName ?? "Tous services"} · {route.villages.length} village{route.villages.length > 1 ? "s" : ""}
          </p>
        </div>
        {canEdit && !editing && (
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setEditing(true)}>
            Modifier
          </button>
        )}
      </div>

      {!editing ? (
        <>
          {route.notes && <p className="whitespace-pre-line rounded-lg bg-navy/[0.035] px-3 py-2 text-sm text-navy/75">{route.notes}</p>}
          {route.villages.length === 0 ? (
            <p className="text-sm text-navy/55">Aucun village renseigné.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-navy/[0.07]">
              {route.villages.map((v, i) => (
                <li key={i} className="flex gap-3 py-2.5">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold tabular-nums text-teal">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {v.name}
                      {v.postal_code && <span className="ml-1.5 text-sm font-normal tabular-nums text-navy/60">{v.postal_code}</span>}
                    </p>
                    {v.notes && <p className="mt-0.5 whitespace-pre-line text-sm text-navy/70">{v.notes}</p>}
                  </div>
                  <a href={mapsLink(v)} target="_blank" rel="noreferrer" className="shrink-0 self-center text-teal-ink" aria-label={`Ouvrir ${v.name} dans Google Maps`}>
                    <IconMapPin className="h-5 w-5" />
                  </a>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="label">Service</span>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Tous services</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Consignes générales de la tournée</span>
            <textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Horaires de chargement, ordre conseillé, points d'attention…" />
          </label>

          <p className="label !mb-0">Villages, dans l&apos;ordre de passage</p>
          {villages.map((v, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-xl border border-navy/[0.08] p-2.5">
              <div className="flex gap-2">
                <span className="mt-2 w-5 shrink-0 text-center text-sm font-semibold tabular-nums text-navy/60">{i + 1}</span>
                <input className="input flex-1 !py-1.5" placeholder="Village" value={v.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={`Village ${i + 1}`} />
                <input
                  className="input w-24 !py-1.5"
                  placeholder="CP"
                  inputMode="numeric"
                  value={v.postal_code ?? ""}
                  onChange={(e) => update(i, { postal_code: e.target.value })}
                  aria-label={`Code postal du village ${i + 1}`}
                />
              </div>
              <textarea
                className="input min-h-[52px] !py-1.5 text-sm"
                placeholder="Infos utiles : accès, horaires, code portail, contact sur place…"
                value={v.notes ?? ""}
                onChange={(e) => update(i, { notes: e.target.value })}
                aria-label={`Infos du village ${i + 1}`}
              />
              <div className="flex gap-1.5 text-xs">
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">
                  ↑
                </button>
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => move(i, 1)} disabled={i === villages.length - 1} aria-label="Descendre">
                  ↓
                </button>
                <button type="button" className="btn-ghost ml-auto !px-2 !py-1 text-orange-ink" onClick={() => setVillages(villages.filter((_, j) => j !== i))}>
                  Retirer
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn-secondary w-fit !py-1.5 text-sm" onClick={() => setVillages([...villages, { name: "", postal_code: null, notes: null }])}>
            + Ajouter un village
          </button>

          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary !py-2 text-sm" disabled={busy} onClick={save}>
              Enregistrer
            </button>
            <button
              type="button"
              className="btn-secondary !py-2 text-sm"
              disabled={busy}
              onClick={() => {
                setVillages(route.villages);
                setNotes(route.notes ?? "");
                setServiceId(route.serviceId ?? "");
                setEditing(false);
              }}
            >
              Annuler
            </button>
            <button type="button" className="btn-ghost ml-auto !py-2 text-sm text-orange-ink" disabled={busy} onClick={remove}>
              Supprimer la fiche
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function TourRoutesBoard({
  routes,
  canEdit,
  services,
  missingTourNumbers,
}: {
  routes: TourRoute[];
  canEdit: boolean;
  services: { id: string; name: string }[];
  missingTourNumbers: string[];
}) {
  const router = useRouter();
  const [tourNumber, setTourNumber] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function create(number: string, service: string | null) {
    setBusy(true);
    setError(null);
    try {
      await send("/api/tour-routes", "POST", { tour_number: number.trim(), service_id: service || null });
      setTourNumber("");
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? routes.filter((r) => r.tourNumber.toLowerCase().includes(q) || r.villages.some((v) => v.name.toLowerCase().includes(q) || (v.postal_code ?? "").includes(q)))
    : routes;

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block flex-1">
              <span className="label">Nouvelle tournée</span>
              <input className="input" placeholder="N° de tournée, ex. T106" value={tourNumber} onChange={(e) => setTourNumber(e.target.value)} />
            </label>
            <label className="block sm:w-56">
              <span className="label">Service</span>
              <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Tous services</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-primary shrink-0" disabled={busy || !tourNumber.trim()} onClick={() => create(tourNumber, serviceId)}>
              Créer
            </button>
          </div>
          {missingTourNumbers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-navy/60">Tournées du planning sans fiche :</span>
              {missingTourNumbers.map((n) => (
                <button key={n} type="button" className="btn-secondary !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => create(n, serviceId)}>
                  + {n}
                </button>
              ))}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        </Card>
      )}

      {routes.length > 3 && (
        <input className="input" type="search" placeholder="Chercher une tournée ou un village…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Chercher une tournée ou un village" />
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-navy/60">{routes.length === 0 ? "Aucune tournée renseignée pour le moment." : "Aucun résultat."}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visible.map((r) => (
            <RouteCard key={`${r.id}-${r.villages.length}-${r.notes}`} route={r} canEdit={canEdit} services={services} />
          ))}
        </div>
      )}
    </div>
  );
}
