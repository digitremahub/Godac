"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { IconMapPin } from "@/components/layout/icons";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { renfortCandidates, renfortLabel } from "@/lib/tours/renfort";
import { AddressQrScanner } from "@/components/tours/AddressQrScanner";

// La carte (MapLibre) n'est chargée que si l'on ouvre l'onglet.
const CarteVillages = dynamic(() => import("@/components/tours/CarteVillages").then((m) => m.CarteVillages), {
  ssr: false,
  loading: () => <p className="text-sm text-navy/60">Chargement de la carte…</p>,
});

export interface PlannedStop {
  id?: string;
  type: "ramasse" | "point_relais";
  name?: string;
  address: string;
  time_window?: string;
  notes?: string;
}

export interface Village {
  id?: string;
  name: string;
  postal_code: string | null;
  notes: string | null;
  /** Adresses de ramasse planifiées par la direction, une par ligne. */
  pickup_addresses?: string[];
  /** Ramasses et points relais configurés pour cette affectation de village. */
  planned_stops?: PlannedStop[];
  /** Coordonnées de la commune, mises en cache pour la carte (gestion seulement). */
  lat?: number | null;
  lng?: number | null;
  insee_code?: string | null;
  /** ok | introuvable | null (pas encore cherché). */
  geocode_status?: string | null;
  /** Tournées de renfort qui couvrent ce village le jour affiché. */
  renfortPar?: string[];
}

/** Un passage planifié d'une tournée de renfort, le jour affiché. */
export interface RenfortPassage {
  planningEntryId: string;
  startAt: string;
  /** Nom du chauffeur (gestion seulement). */
  driverName: string | null;
  villageIds: string[];
  /** true : villages choisis pour ce jour ; false : couverture par défaut. */
  specific: boolean;
}

export interface TourRoute {
  id: string;
  tourNumber: string;
  serviceId: string | null;
  serviceName: string | null;
  notes: string | null;
  villages: Village[];
  /** Tournée de renfort : part avec des colis pour des villages d'autres tournées. */
  isRenfort: boolean;
  /** Renfort : villages couverts par défaut (villages d'autres tournées). */
  renfortVillageIds: string[];
  /** Renfort : passages planifiés le jour affiché. */
  passages: RenfortPassage[];
}

/** Un village emprunté, décrit avec sa tournée d'origine. */
export interface VillageRef {
  name: string;
  postal_code: string | null;
  notes: string | null;
  routeId: string;
  tourNumber: string;
  serviceId: string | null;
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

const mapsLink = (v: Pick<Village, "name" | "postal_code">) => `https://www.google.com/maps?q=${encodeURIComponent([v.name, v.postal_code, "France"].filter(Boolean).join(" "))}`;

const jourLong = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function RenfortBadge() {
  return <span className="rounded-full border border-dashed border-navy/40 px-2 py-0.5 text-xs font-semibold text-navy/75">Renfort</span>;
}

/** Villages couverts, regroupés par tournée d'origine. */
function CoveredVillages({ ids, refs }: { ids: string[]; refs: Record<string, VillageRef> }) {
  const groups = new Map<string, { tourNumber: string; villages: (VillageRef & { id: string })[] }>();
  for (const id of ids) {
    const ref = refs[id];
    if (!ref) continue;
    const g = groups.get(ref.routeId) ?? { tourNumber: ref.tourNumber, villages: [] };
    g.villages.push({ ...ref, id });
    groups.set(ref.routeId, g);
  }
  if (!groups.size) return <p className="text-sm text-navy/55">Aucun village couvert.</p>;
  return (
    <div className="flex flex-col gap-2">
      {Array.from(groups.values())
        .sort((a, b) => a.tourNumber.localeCompare(b.tourNumber, "fr", { numeric: true }))
        .map((g) => (
          <div key={g.tourNumber}>
            <p className="text-xs font-semibold uppercase tracking-wide text-navy/55">Villages de la tournée {g.tourNumber}</p>
            <ul className="mt-1 flex flex-col divide-y divide-navy/[0.07]">
              {g.villages.map((v) => (
                <li key={v.id} className="flex gap-3 py-2">
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
            </ul>
          </div>
        ))}
    </div>
  );
}

/** Choix de villages empruntés aux autres tournées, groupés par tournée. */
function VillagePicker({ candidates, selected, onChange }: { candidates: TourRoute[]; selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const avecVillages = candidates.filter((r) => r.villages.some((v) => v.id));
  if (!avecVillages.length) return <p className="text-sm text-navy/55">Aucune autre tournée du service n&apos;a de villages enregistrés.</p>;
  function toggle(ids: string[], on: boolean) {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  }
  return (
    <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto rounded-xl border border-navy/[0.08] p-2.5">
      {avecVillages.map((r) => {
        const ids = r.villages.map((v) => v.id).filter((id): id is string => Boolean(id));
        const tous = ids.every((id) => selected.has(id));
        return (
          <fieldset key={r.id}>
            <legend className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
              <span>
                Tournée {r.tourNumber}
                <span className="font-normal text-navy/60"> · {r.serviceName ?? "Tous services"}</span>
              </span>
              <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => toggle(ids, !tous)}>
                {tous ? "Aucun" : "Tous"}
              </button>
            </legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {r.villages
                .filter((v) => v.id)
                .map((v) => (
                  <label key={v.id} className="flex cursor-pointer items-center gap-1.5 rounded-full bg-navy/[0.045] py-1 pl-2 pr-3 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={selected.has(v.id!)} onChange={(e) => toggle([v.id!], e.target.checked)} />
                    {v.name}
                  </label>
                ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/** Un passage du renfort ce jour-là : villages couverts, et choix du jour pour la gestion. */
function PassageRenfort({
  route,
  passage,
  canEdit,
  candidates,
  refs,
}: {
  route: TourRoute;
  passage: RenfortPassage;
  canEdit: boolean;
  candidates: TourRoute[];
  refs: Record<string, VillageRef>;
}) {
  const router = useRouter();
  const [choix, setChoix] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enregistrer(ids: string[]) {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/tour-routes/${route.id}/renfort-jour`, "PUT", { planning_entry_id: passage.planningEntryId, village_ids: ids });
      setChoix(null);
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-navy/20 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Départ {heure(passage.startAt)}
          {passage.driverName && <span className="font-normal text-navy/60"> · {passage.driverName}</span>}
          <span className="font-normal text-navy/60"> · {passage.specific ? "villages choisis pour ce jour" : "villages par défaut"}</span>
        </p>
        {canEdit && !choix && (
          <div className="flex gap-1.5">
            <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => setChoix(new Set(passage.villageIds))}>
              Choisir les villages du jour
            </button>
            {passage.specific && (
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => enregistrer([])}>
                Revenir au défaut
              </button>
            )}
          </div>
        )}
      </div>
      {choix ? (
        <>
          <VillagePicker candidates={candidates} selected={choix} onChange={setChoix} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary !py-1.5 text-sm" disabled={busy} onClick={() => enregistrer(Array.from(choix))}>
              Enregistrer pour ce jour
            </button>
            <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={busy} onClick={() => setChoix(null)}>
              Annuler
            </button>
          </div>
          <p className="text-xs text-navy/55">Aucun village coché : le renfort reprend sa couverture par défaut ce jour-là.</p>
        </>
      ) : (
        <CoveredVillages ids={passage.villageIds} refs={refs} />
      )}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
    </div>
  );
}

function RouteCard({
  route,
  allRoutes,
  canEdit,
  services,
  renfortReady,
  refs,
  jour,
  today,
  onVillageDrop,
}: {
  onVillageDrop: (sourceRouteId: string, village: Village, targetRouteId: string, duplicate: boolean) => Promise<void>;
  route: TourRoute;
  allRoutes: TourRoute[];
  canEdit: boolean;
  services: { id: string; name: string }[];
  renfortReady: boolean;
  refs: Record<string, VillageRef>;
  jour: string;
  today: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [villages, setVillages] = useState<Village[]>(route.villages);
  const [notes, setNotes] = useState(route.notes ?? "");
  const [serviceId, setServiceId] = useState(route.serviceId ?? "");
  const [villageSearch, setVillageSearch] = useState("");
  const [villageSuggestions, setVillageSuggestions] = useState<Array<{name:string; postal_code:string|null}>>([]);
  const [searchingVillages, setSearchingVillages] = useState(false);
  const [stopAddressQuery, setStopAddressQuery] = useState<{ key: string; value: string } | null>(null);
  const [stopAddressSuggestions, setStopAddressSuggestions] = useState<Array<{ label: string; name: string; postal_code: string | null }>>([]);
  const [searchingStopAddress, setSearchingStopAddress] = useState(false);
  const [scanAddressKey, setScanAddressKey] = useState<string | null>(null);
  const [isRenfort, setIsRenfort] = useState(route.isRenfort);
  const [couverture, setCouverture] = useState<Set<string>>(new Set(route.renfortVillageIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyTargetRouteId, setCopyTargetRouteId] = useState("");
  const [copyingVillageIndex, setCopyingVillageIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const candidates = useMemo(() => renfortCandidates(allRoutes, { id: route.id, serviceId: (editing ? serviceId : route.serviceId) || null }), [allRoutes, route.id, route.serviceId, serviceId, editing]);
  const quand = jour === today ? "aujourd'hui" : `le ${jourLong(jour)}`;

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

  async function copyVillageToRoute(village: Village, index: number) {
    if (!copyTargetRouteId) {
      setError("Choisissez d'abord la tournée de destination.");
      return;
    }
    const target = allRoutes.find((r) => r.id === copyTargetRouteId);
    if (!target || target.isRenfort) {
      setError("Choisissez une tournée classique de destination.");
      return;
    }
    setBusy(true);
    setError(null);
    setCopyingVillageIndex(index);
    try {
      await send(`/api/tour-routes/${target.id}/villages`, "PUT", {
        villages: [
          ...target.villages.map((v) => ({
            ...(v.id ? { id: v.id } : {}),
            name: v.name,
            postal_code: v.postal_code,
            notes: v.notes,
            pickup_addresses: v.pickup_addresses ?? [],
            planned_stops: v.planned_stops ?? [],
          })),
          {
            name: village.name.trim(),
            postal_code: village.postal_code?.trim() || null,
            notes: village.notes?.trim() || null,
            pickup_addresses: village.pickup_addresses ?? [],
            planned_stops: village.planned_stops ?? [],
          },
        ],
      });
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusy(false);
      setCopyingVillageIndex(null);
    }
  }

  async function searchStopAddress(key: string, query: string) {
    setStopAddressQuery({ key, value: query });
    if (query.trim().length < 3) { setStopAddressSuggestions([]); return; }
    setSearchingStopAddress(true);
    try {
      const res = await fetch(`/api/tour-routes/villages/search?q=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (res.ok && Array.isArray(json.results)) {
        setStopAddressSuggestions(json.results.filter((item: any) => item.label).map((item: any) => ({
          label: String(item.label), name: String(item.name ?? item.label), postal_code: item.postal_code ? String(item.postal_code) : null,
        })));
      } else setStopAddressSuggestions([]);
    } catch { setStopAddressSuggestions([]); }
    finally { setSearchingStopAddress(false); }
  }

  async function searchVillages(query: string) {
    setVillageSearch(query);
    if (query.trim().length < 3) { setVillageSuggestions([]); return; }
    setSearchingVillages(true);
    try {
      const res = await fetch(`/api/tour-routes/villages/search?q=${encodeURIComponent(query.trim())}`);
      const json = await res.json();
      if (res.ok && Array.isArray(json.results)) setVillageSuggestions(json.results);
      else setVillageSuggestions([]);
    } catch { setVillageSuggestions([]); }
    finally { setSearchingVillages(false); }
  }

  function addVillageFromSearch(item: { name: string; postal_code: string | null }) {
    const name = item.name.trim();
    const postalCode = item.postal_code ?? null;
    const sameVillage = (v: Village) =>
      v.name.trim().toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr") &&
      (v.postal_code ?? "") === (postalCode ?? "");
    if (villages.some(sameVillage)) {
      setError(`Le village ${name} est déjà présent dans cette tournée.`);
      return;
    }
    const otherRoutes = allRoutes.filter((r) => r.id !== route.id && !r.isRenfort && r.villages.some(sameVillage));
    if (otherRoutes.length > 0) {
      const tours = otherRoutes.map((r) => r.tourNumber).join(", ");
      if (!window.confirm(`Attention : ${name} est déjà présent dans la/les tournée(s) ${tours}. Voulez-vous vraiment l'ajouter aussi à la tournée ${route.tourNumber} ?`)) return;
      if (!window.confirm(`Deuxième confirmation : le village ${name} sera affecté à plusieurs tournées. Confirmez-vous l'ajout à la tournée ${route.tourNumber} ?`)) return;
    }
    setError(null);
    setVillages((current) => [...current, {
      name,
      postal_code: postalCode,
      notes: null,
      pickup_addresses: [],
      planned_stops: [],
    }]);
    setVillageSearch("");
    setVillageSuggestions([]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/tour-routes/${route.id}`, "PATCH", {
        notes: notes.trim() || null,
        service_id: serviceId || null,
        ...(renfortReady && isRenfort !== route.isRenfort ? { is_renfort: isRenfort } : {}),
      });
      if (isRenfort) {
        await send(`/api/tour-routes/${route.id}/renfort`, "PUT", { village_ids: Array.from(couverture) });
      } else {
        await send(`/api/tour-routes/${route.id}/villages`, "PUT", {
          villages: villages
            .filter((v) => v.name.trim())
            .map((v) => ({ ...(v.id ? { id: v.id } : {}), name: v.name.trim(), postal_code: v.postal_code?.trim() || null, notes: v.notes?.trim() || null, pickup_addresses: v.pickup_addresses ?? [], planned_stops: v.planned_stops ?? [] })),
        });
      }
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

  const nbCouverts = route.renfortVillageIds.length;

  return (
    <div className={dragOver ? "rounded-xl ring-2 ring-teal-ink" : ""} onDragOver={(e) => { if (canEdit && !route.isRenfort) { e.preventDefault(); setDragOver(true); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }} onDrop={async (e) => { e.preventDefault(); setDragOver(false); if (!canEdit || route.isRenfort) return; try { const data = JSON.parse(e.dataTransfer.getData("application/x-godac-village")); if (data.routeId !== route.id && data.village) await onVillageDrop(data.routeId, data.village as Village, route.id, e.altKey); } catch (err) { setError(err instanceof Error ? err.message : "Impossible de déplacer le village."); } }}>
      <Card className={`flex flex-col gap-3 transition-colors ${dragOver ? "border-2 border-teal-ink bg-teal/5" : ""} ${route.isRenfort ? "border border-dashed border-navy/25" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-lg tabular-nums">
            Tournée {route.tourNumber}
            {route.isRenfort && <RenfortBadge />}
          </h2>
          <p className="text-sm text-navy/60">
            {route.serviceName ?? "Tous services"} ·{" "}
            {route.isRenfort
              ? `${nbCouverts} village${nbCouverts > 1 ? "s" : ""} d'autres tournées par défaut`
              : `${route.villages.length} village${route.villages.length > 1 ? "s" : ""}`}
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
          {canEdit && !route.isRenfort && <p className={`rounded-lg border border-dashed px-3 py-2 text-xs ${dragOver ? "border-teal-ink bg-teal/10 text-navy" : "border-navy/20 text-navy/60"}`}>{dragOver ? "Déposez pour déplacer le village ici · Alt + dépôt pour le dupliquer" : "Astuce : faites glisser un village vers une autre tournée. Maintenez Alt pour le dupliquer."}</p>}
          {canEdit && !route.isRenfort && <p className={`rounded-lg border border-dashed px-3 py-2 text-xs ${dragOver ? "border-teal-ink bg-teal/10 text-navy" : "border-navy/20 text-navy/60"}`}>{dragOver ? "Déposez ici pour déplacer · maintenez Alt pour dupliquer" : "Glissez un village vers une autre tournée. Maintenez Alt pendant le dépôt pour le dupliquer."}</p>}
          {route.notes && <p className="whitespace-pre-line rounded-lg bg-navy/[0.035] px-3 py-2 text-sm text-navy/75">{route.notes}</p>}

          {route.isRenfort && (
            <>
              <p className="text-sm text-navy/70">Tournée de renfort : elle part avec des colis pour des villages d&apos;autres tournées du service.</p>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Passages {quand}</h3>
                {route.passages.length === 0 ? (
                  <p className="text-sm text-navy/55">Pas de passage planifié {quand}.</p>
                ) : (
                  route.passages.map((p) => <PassageRenfort key={p.planningEntryId} route={route} passage={p} canEdit={canEdit} candidates={candidates} refs={refs} />)
                )}
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Villages couverts par défaut</h3>
                <CoveredVillages ids={route.renfortVillageIds} refs={refs} />
              </section>
            </>
          )}

          {route.villages.length === 0 ? (
            route.isRenfort ? null : <p className="text-sm text-navy/55">Aucun village renseigné.</p>
          ) : (
            <>
              {route.isRenfort && <h3 className="text-sm font-semibold">Villages propres à la fiche</h3>}
              <ol className="flex flex-col divide-y divide-navy/[0.07]">
                {route.villages.map((v, i) => (
                  <li key={v.id ?? i} draggable={canEdit && !route.isRenfort} onDragStart={(e) => { e.dataTransfer.setData("application/x-godac-village", JSON.stringify({ routeId: route.id, village: v })); e.dataTransfer.effectAllowed = "copyMove"; }} className={`flex gap-3 py-2.5 ${canEdit && !route.isRenfort ? "cursor-grab active:cursor-grabbing" : ""}`}>
                    <span title={canEdit && !route.isRenfort ? "Glissez ce village vers une autre tournée" : undefined} className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold tabular-nums text-teal">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {v.name}
                        {v.postal_code && <span className="ml-1.5 text-sm font-normal tabular-nums text-navy/60">{v.postal_code}</span>}
                      </p>
                      {v.renfortPar?.length ? (
                        <p className="mt-1 w-fit rounded-full border border-dashed border-navy/30 px-2 py-0.5 text-xs font-semibold text-navy/75">
                          {renfortLabel(v.renfortPar)} {quand}
                        </p>
                      ) : null}
                      {v.notes && <p className="mt-0.5 whitespace-pre-line text-sm text-navy/70">{v.notes}</p>}
                      {((v.planned_stops ?? []).length > 0 || (v.pickup_addresses ?? []).length > 0) && (
                        <div className="mt-2 rounded-lg border border-gold/40 bg-gold/10 p-2">
                          <p className="text-xs font-bold uppercase tracking-wide">Arrêts professionnels prévus</p>
                          <ul className="mt-1 list-inside list-disc text-sm">
                            {(v.planned_stops ?? []).map((stop, j) => <li key={stop.id ?? j}><span className="font-semibold">{stop.type === "point_relais" ? "Point relais" : "Ramasse"}{stop.name ? ` · ${stop.name}` : ""} :</span> {stop.address}{stop.time_window ? ` · ${stop.time_window}` : ""}{stop.notes ? ` — ${stop.notes}` : ""}</li>)}
                            {(v.pickup_addresses ?? []).map((address, j) => <li key={`legacy-${j}`}><span className="font-semibold">Ramasse :</span> {address}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                    <a href={mapsLink(v)} target="_blank" rel="noreferrer" className="shrink-0 self-center text-teal-ink" aria-label={`Ouvrir ${v.name} dans Google Maps`}>
                      <IconMapPin className="h-5 w-5" />
                    </a>
                  </li>
                ))}
              </ol>
            </>
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
          {renfortReady && (
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={isRenfort} onChange={(e) => setIsRenfort(e.target.checked)} />
              <span className="text-sm">
                <span className="font-semibold">Tournée de renfort</span>
                <span className="block text-navy/60">Elle part avec des colis pour des villages de plusieurs autres tournées du service ; chaque village reste rattaché à sa tournée.</span>
              </span>
            </label>
          )}
          <label className="block">
            <span className="label">Consignes générales de la tournée</span>
            <textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Horaires de chargement, ordre conseillé, points d'attention…" />
          </label>

          {isRenfort ? (
            <>
              <p className="label !mb-0">Villages couverts par défaut</p>
              <VillagePicker candidates={candidates} selected={couverture} onChange={setCouverture} />
              <p className="text-xs text-navy/55">
                Le jour venu, vous pourrez choisir d&apos;autres villages pour un passage précis. Les villages couverts apparaissent « en renfort » sur leur tournée.
                {route.villages.length > 0 && " Les villages propres à cette fiche restent affichés tels quels."}
              </p>
            </>
          ) : (
            <>
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
                  <section className="flex flex-col gap-2 rounded-lg bg-navy/[0.025] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div><h3 className="text-sm font-semibold">Ramasses et points relais</h3><p className="text-xs text-navy/60">Chaque arrêt possède sa propre fiche.</p></div>
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold">{(v.planned_stops ?? []).length} arrêt(s)</span>
                    </div>
                    {(v.planned_stops ?? []).map((stop, stopIndex) => (
                      <div key={stop.id ?? stopIndex} className="flex flex-col gap-2 rounded-lg border border-navy/10 bg-white p-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold text-teal">{stopIndex + 1}</span>
                          <select className="input flex-1 !py-1.5 text-sm" value={stop.type} onChange={(e) => update(i, { planned_stops: (v.planned_stops ?? []).map((s, j) => j === stopIndex ? { ...s, type: e.target.value as PlannedStop["type"] } : s) })} aria-label={`Type de l'arrêt ${stopIndex + 1}`}>
                            <option value="ramasse">Ramasse</option><option value="point_relais">Point relais</option>
                          </select>
                          <button type="button" className="btn-ghost !px-2 !py-1 text-sm text-orange-ink" onClick={() => update(i, { planned_stops: (v.planned_stops ?? []).filter((_, j) => j !== stopIndex) })}>Supprimer</button>
                        </div>
                        <label className="block"><span className="label">Nom du professionnel / point relais</span>
                          <input className="input !py-1.5 text-sm" value={stop.name ?? ""} onChange={(e) => update(i, { planned_stops: (v.planned_stops ?? []).map((s, j) => j === stopIndex ? { ...s, name: e.target.value } : s) })} placeholder="Ex. Boulangerie Martin" />
                        </label>
                        <div className="relative">
                          <label className="block"><span className="label">Rechercher une adresse</span>
                            <input className="input !py-1.5 text-sm" value={stopAddressQuery?.key === `${i}-${stopIndex}` ? stopAddressQuery.value : stop.address} onChange={(e) => void searchStopAddress(`${i}-${stopIndex}`, e.target.value)} placeholder="Tapez une rue, une entreprise ou une adresse…" autoComplete="off" />
                          </label>
                          {searchingStopAddress && stopAddressQuery?.key === `${i}-${stopIndex}` && <p className="mt-1 text-xs text-navy/60">Recherche d’adresses…</p>}
                          {stopAddressQuery?.key === `${i}-${stopIndex}` && stopAddressSuggestions.length > 0 && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-navy/15 bg-white shadow-lg">{stopAddressSuggestions.map((item, suggestionIndex) => <button type="button" key={`${item.label}-${suggestionIndex}`} className="block w-full border-b border-navy/10 px-3 py-2 text-left text-sm last:border-0 hover:bg-navy/[0.04]" onClick={() => { update(i, { planned_stops: (v.planned_stops ?? []).map((s, j) => j === stopIndex ? { ...s, address: item.label } : s) }); setStopAddressQuery(null); setStopAddressSuggestions([]); }}>{item.label}</button>)}</div>}
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <p className="text-xs text-navy/55">Sélectionnez une suggestion pour remplir l’adresse complète.</p>
                            <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setScanAddressKey(scanAddressKey === `${i}-${stopIndex}` ? null : `${i}-${stopIndex}`)}>Scanner un QR code</button>
                          </div>
                          {scanAddressKey === `${i}-${stopIndex}` && <AddressQrScanner onClose={() => setScanAddressKey(null)} onScan={(value) => { update(i, { planned_stops: (v.planned_stops ?? []).map((s, j) => j === stopIndex ? { ...s, address: value } : s) }); setStopAddressQuery({ key: `${i}-${stopIndex}`, value }); setStopAddressSuggestions([]); setScanAddressKey(null); }} />}
                        </div>
                        <label className="block"><span className="label">{stop.type === "ramasse" ? "Tranche horaire prévue au contrat" : "Horaires d'ouverture du point relais"}</span>
                          <select className="input !py-1.5 text-sm" value={["08:00-11:00","10:00-13:00","12:00-15:00","14:00-17:00"].includes(stop.time_window ?? "") ? stop.time_window : stop.time_window ? "custom" : ""} onChange={(e) => update(i, { planned_stops: (v.planned_stops ?? []).map((s, j) => j === stopIndex ? { ...s, time_window: e.target.value === "custom" ? s.time_window ?? "" : e.target.value } : s) })}>
                            <option value="">Choisir un créneau…</option>
                            <option value="08:00-11:00">08:00–11:00</option>
                            <option value="10:00-13:00">10:00–13:00</option>
                            <option value="12:00-15:00">12:00–15:00</option>
                            <option value="14:00-17:00">14:00–17:00</option>
                            <option value="custom">Autre créneau / horaires détaillés</option>
                          </select>
                          {(!stop.time_window || !["08:00-11:00","10:00-13:00","12:00-15:00","14:00-17:00"].includes(stop.time_window)) && <input className="input mt-1 !py-1.5 text-sm" value={stop.time_window ?? ""} onChange={(e) => update(i, { planned_stops: (v.planned_stops ?? []).map((s, j) => j === stopIndex ? { ...s, time_window: e.target.value } : s) })} placeholder={stop.type === "ramasse" ? "Ex. 09:30-10:00" : "Ex. lun-ven 09:00-12:00, 14:00-18:00"} />}
                          <span className="mt-1 block text-xs text-navy/55">{stop.type === "ramasse" ? "Saisissez la tranche prévue dans le contrat de ramasse." : "Saisissez les horaires réels d'ouverture du relais."}</span>
                        </label>
                        <label className="block"><span className="label">Consignes (facultatif)</span>
                          <textarea className="input min-h-[48px] !py-1.5 text-sm" value={stop.notes ?? ""} onChange={(e) => update(i, { planned_stops: (v.planned_stops ?? []).map((s, j) => j === stopIndex ? { ...s, notes: e.target.value } : s) })} placeholder="Contact, accès, code portail, nombre de colis…" />
                        </label>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => update(i, { planned_stops: [...(v.planned_stops ?? []), { type: "ramasse", address: "" }] })}>+ Ajouter une ramasse</button>
                      <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => update(i, { planned_stops: [...(v.planned_stops ?? []), { type: "point_relais", address: "" }] })}>+ Ajouter un point relais</button>
                    </div>
                  </section>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <select className="input min-w-0 flex-1 !py-1 text-xs" value={copyTargetRouteId} onChange={(e) => setCopyTargetRouteId(e.target.value)} aria-label={`Tournée de destination pour ${v.name || `village ${i + 1}`}`}>
                      <option value="">Copier vers une autre tournée…</option>
                      {allRoutes.filter((r) => r.id !== route.id && !r.isRenfort).map((r) => <option key={r.id} value={r.id}>Tournée {r.tourNumber} · {r.serviceName ?? "Tous services"}</option>)}
                    </select>
                    <button type="button" className="btn-secondary !px-2 !py-1" disabled={busy || !v.name.trim() || !copyTargetRouteId} onClick={() => copyVillageToRoute(v, i)}>
                      {copyingVillageIndex === i ? "Copie…" : "Dupliquer le village"}
                    </button>
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
              <div className="flex flex-col gap-2">
                <label className="block max-w-xl">
                  <span className="label">Rechercher un village ou une adresse</span>
                  <input className="input" value={villageSearch} onChange={(e) => void searchVillages(e.target.value)} placeholder="Nom de ville, code postal, rue ou adresse…" />
                </label>
                {searchingVillages && <p className="text-xs text-navy/60">Recherche…</p>}
                {villageSuggestions.length > 0 && <div className="max-w-xl overflow-hidden rounded-lg border border-navy/15 bg-white">{villageSuggestions.map((item, index) => <button type="button" key={`${item.name}-${item.postal_code}-${index}`} className="block w-full border-b border-navy/10 px-3 py-2 text-left text-sm last:border-0 hover:bg-navy/[0.04]" onClick={() => addVillageFromSearch(item)}>{item.name}{item.postal_code ? ` · ${item.postal_code}` : ""}</button>)}</div>}
                <button type="button" className="btn-secondary w-fit !py-1.5 text-sm" onClick={() => setVillages([...villages, { name: "", postal_code: null, notes: null, pickup_addresses: [], planned_stops: [] }])}>+ Ajouter un village manuellement</button>
              </div>
            </>
          )}

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
                setIsRenfort(route.isRenfort);
                setCouverture(new Set(route.renfortVillageIds));
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
    </Card></div>
  );
}

export function TourRoutesBoard({
  routes,
  canEdit,
  canSeeMap = false,
  services,
  missingTourNumbers,
  geoReady = false,
  renfortReady = false,
  villageRefs = {},
  jour,
  today,
}: {
  routes: TourRoute[];
  canEdit: boolean;
  /** Onglet « Carte » et incohérences : chefs d'équipe et direction seulement. */
  canSeeMap?: boolean;
  services: { id: string; name: string }[];
  missingTourNumbers: string[];
  /** Les colonnes de coordonnées des villages existent (migration passée). */
  geoReady?: boolean;
  /** Les tournées de renfort sont disponibles (migration passée). */
  renfortReady?: boolean;
  /** Villages empruntés par les renforts, avec leur tournée d'origine. */
  villageRefs?: Record<string, VillageRef>;
  /** Jour affiché pour les renforts (AAAA-MM-JJ, heure de Paris). */
  jour: string;
  today: string;
}) {
  const router = useRouter();
  const [tourNumber, setTourNumber] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onglet, setOnglet] = useState<"fiches" | "carte">("fiches");

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
    ? routes.filter(
        (r) =>
          r.tourNumber.toLowerCase().includes(q) ||
          r.villages.some((v) => v.name.toLowerCase().includes(q) || (v.postal_code ?? "").includes(q)) ||
          r.renfortVillageIds.some((id) => villageRefs[id]?.name.toLowerCase().includes(q)),
      )
    : routes;
  // Tournées fixes d'abord, renforts ensuite.
  const ordered = [...visible.filter((r) => !r.isRenfort), ...visible.filter((r) => r.isRenfort)];
  async function handleVillageDrop(sourceRouteId: string, village: Village, targetRouteId: string, duplicate: boolean) {
    const source = routes.find((r) => r.id === sourceRouteId);
    const target = routes.find((r) => r.id === targetRouteId);
    if (!source || !target || source.id === target.id || target.isRenfort || source.isRenfort) return;
    if (target.villages.some((v) => v.name.trim().toLocaleLowerCase("fr") === village.name.trim().toLocaleLowerCase("fr") && (v.postal_code ?? "") === (village.postal_code ?? ""))) {
      throw new Error("Ce village existe déjà dans la tournée de destination.");
    }
    const toPayload = (v: Village, includeId = true) => ({
      ...(includeId && v.id ? { id: v.id } : {}),
      name: v.name, postal_code: v.postal_code, notes: v.notes,
      pickup_addresses: v.pickup_addresses ?? [], planned_stops: v.planned_stops ?? [],
    });
    await send(`/api/tour-routes/${target.id}/villages`, "PUT", { villages: [...target.villages.map((v) => toPayload(v)), toPayload(village, false)] });
    if (!duplicate && village.id) {
      try {
        await send(`/api/tour-routes/${source.id}/villages`, "PUT", { villages: source.villages.filter((v) => v.id !== village.id).map((v) => toPayload(v)) });
      } catch (e) {
        router.refresh();
        throw new Error("Le village a été copié dans la tournée cible, mais son retrait de la tournée d'origine a échoué. Vérifiez les deux tournées avant de recommencer.");
      }
    }
    router.refresh();
  }


  const montreCarte = canSeeMap && onglet === "carte";
  const avecRenfort = renfortReady && routes.some((r) => r.isRenfort);

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
          {renfortReady && <p className="text-xs text-navy/55">Une tournée de renfort se crée comme les autres, puis « Modifier » → « Tournée de renfort ». Elle se planifie avec son numéro, comme toute tournée.</p>}
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        </Card>
      )}

      {routes.length > 0 && (canSeeMap || avecRenfort) && (
        <div className="flex flex-wrap items-end gap-2">
          {canSeeMap && (
            <div role="tablist" aria-label="Affichage" className="flex flex-wrap gap-2">
              {(
                [
                  ["fiches", "Fiches"],
                  ["carte", "Carte"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={onglet === key}
                  className={onglet === key ? "btn-primary !px-3 !py-1.5 text-sm" : "btn-secondary !px-3 !py-1.5 text-sm"}
                  onClick={() => setOnglet(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {avecRenfort && !montreCarte && (
            <label className="ml-auto flex items-center gap-2 text-sm">
              <span className="text-navy/60">Renforts du</span>
              <input
                type="date"
                className="input !w-auto !py-1.5"
                value={jour}
                onChange={(e) => {
                  if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) router.push(`/tours/routes${e.target.value === today ? "" : `?jour=${e.target.value}`}`);
                }}
                aria-label="Jour affiché pour les renforts"
              />
            </label>
          )}
        </div>
      )}

      {montreCarte && routes.length > 0 ? (
        <CarteVillages routes={routes} services={services} geoReady={geoReady} />
      ) : (
        <>
          {routes.length > 3 && (
            <input className="input" type="search" placeholder="Chercher une tournée ou un village…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Chercher une tournée ou un village" />
          )}

          {ordered.length === 0 ? (
            <p className="text-sm text-navy/60">{routes.length === 0 ? "Aucune tournée renseignée pour le moment." : "Aucun résultat."}</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {ordered.map((r) => (
                <RouteCard
                  key={`${r.id}-${r.villages.map((v) => v.id).join(",")}-${r.notes}-${r.isRenfort}-${r.renfortVillageIds.join(",")}`}
                  route={r}
                  allRoutes={routes}
                  canEdit={canEdit}
                  services={services}
                  renfortReady={renfortReady}
                  refs={villageRefs}
                  jour={jour}
                  today={today}
                  onVillageDrop={handleVillageDrop}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
