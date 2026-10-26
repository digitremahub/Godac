"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { IconMapPin } from "@/components/layout/icons";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { renfortCandidates, renfortLabel } from "@/lib/tours/renfort";
import { AjoutVillage, chercherCommunes } from "@/components/tours/AjoutVillage";
import { VillageEditeur } from "@/components/tours/VillageEditeur";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { avecSuggestion, codePostalValide, completerCodePostal, indexDoublon, memeVillage, type SuggestionCommune } from "@/lib/tours/ajout-village";
import { cleVillage, rechercherVillages } from "@/lib/tours/recherche-villages";
import { confirmer } from "@/lib/ui/confirmation";

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
  postal_code?: string;
  city?: string;
  lat?: number;
  lng?: number;
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
  /** Clé locale d'un village ajouté dans l'éditeur (pas encore enregistré). */
  cleLocale?: string;
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

/** Coordonnées connues d'un village, à enregistrer avec lui (évite un géocodage ultérieur). */
const coordonneesVillage = (v: Village) =>
  typeof v.lat === "number" && typeof v.lng === "number" ? { lat: v.lat, lng: v.lng, insee_code: v.insee_code ?? null } : {};

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
  surlignes,
}: {
  /** Villages trouvés par la recherche, à mettre en évidence (clés `cleVillage`). */
  surlignes?: Set<string>;
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
  const [candidatsCp, setCandidatsCp] = useState<Record<string, SuggestionCommune[]>>({});
  const [infoCp, setInfoCp] = useState<string | null>(null);
  const [rechercheCp, setRechercheCp] = useState(false);
  const compteurCle = useRef(0);
  const [isRenfort, setIsRenfort] = useState(route.isRenfort);
  const [couverture, setCouverture] = useState<Set<string>>(new Set(route.renfortVillageIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const cleCarte = (v: Village, i: number) => v.id ?? v.cleLocale ?? `#${i}`;
  const domVillage = (i: number) => `village-${route.id}-${i}`;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function deposer(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const de = villages.findIndex((v, i) => cleCarte(v, i) === e.active.id);
    const vers = villages.findIndex((v, i) => cleCarte(v, i) === e.over!.id);
    if (de >= 0 && vers >= 0) setVillages(arrayMove(villages, de, vers));
  }

  function focusVillage(i: number) {
    const el = document.getElementById(domVillage(i));
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }

  async function copyVillageToRoute(village: Village, index: number, targetRouteId: string) {
    const target = allRoutes.find((r) => r.id === targetRouteId);
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
            ...coordonneesVillage(village),
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

  /** Ajoute un village à la fiche ; renvoie un message si rien n'est ajouté. */
  async function ajouterVillage(nouveau: Village): Promise<string | null> {
    const name = nouveau.name;
    const existant = indexDoublon(villages, nouveau);
    if (existant >= 0) {
      // Village déjà là sans code postal : la suggestion le complète.
      if (!codePostalValide(villages[existant]!.postal_code) && codePostalValide(nouveau.postal_code)) {
        setVillages((cur) => cur.map((v, i) => (i === existant ? { ...v, ...coordonneesVillage(nouveau), name, postal_code: nouveau.postal_code, insee_code: nouveau.insee_code } : v)));
      }
      focusVillage(existant);
      return `${name} est déjà dans la fiche (n° ${existant + 1}).`;
    }
    const autres = allRoutes.filter((r) => r.id !== route.id && !r.isRenfort && r.villages.some((v) => memeVillage(v, nouveau)));
    if (autres.length > 0) {
      const tours = autres.map((r) => r.tourNumber).join(", ");
      if (!(await confirmer({ titre: `${name} est déjà dans la tournée ${tours}`, message: `Voulez-vous vraiment l'ajouter aussi à la tournée ${route.tourNumber} ?`, action: "Ajouter aussi" }))) return null;
      if (!(await confirmer({ titre: "Deuxième confirmation", message: `Le village ${name} sera affecté à plusieurs tournées. Confirmez-vous l'ajout à la tournée ${route.tourNumber} ?`, action: "Confirmer l'ajout" }))) return null;
    }
    setError(null);
    const cleLocale = `n${++compteurCle.current}`;
    setVillages((cur) => [...cur, { ...nouveau, cleLocale, notes: null, pickup_addresses: [], planned_stops: [] }]);
    return null;
  }

  const ajouterDepuisSuggestion = (s: SuggestionCommune) =>
    ajouterVillage({ name: s.name, postal_code: s.postal_code, notes: null, lat: s.lat, lng: s.lng, insee_code: s.insee_code });

  /**
   * Code postal des villages qui n'en ont pas : rempli (avec les
   * coordonnées) quand la commune est trouvée sans ambiguïté, sinon les
   * candidats sont proposés sur la carte du village.
   */
  async function completerCodesPostaux() {
    const cibles = villages.map((v, i) => ({ cle: cleCarte(v, i), nom: v.name.trim(), cp: v.postal_code })).filter((c) => c.nom && !codePostalValide(c.cp));
    if (cibles.length === 0) return;
    setRechercheCp(true);
    setInfoCp(null);
    let remplis = 0;
    let ambigus = 0;
    let injoignable = false;
    const propositions: Record<string, SuggestionCommune[]> = {};
    for (const c of cibles.slice(0, 15)) {
      try {
        const r = await chercherCommunes(c.nom);
        if (r.indisponible) { injoignable = true; break; }
        const resultat = completerCodePostal(c.nom, r.results);
        if (resultat.statut === "ok") {
          remplis++;
          setVillages((cur) => cur.map((v, i) => (cleCarte(v, i) === c.cle && !codePostalValide(v.postal_code) ? avecSuggestion(v, resultat.suggestion) : v)));
        } else if (resultat.statut === "ambigu") {
          ambigus++;
          propositions[c.cle] = resultat.candidats;
        }
      } catch {
        injoignable = true;
        break;
      }
    }
    setCandidatsCp((cur) => ({ ...cur, ...propositions }));
    setRechercheCp(false);
    setInfoCp(
      injoignable
        ? "Recherche des codes postaux indisponible pour le moment."
        : [remplis ? `${remplis} code${remplis > 1 ? "s" : ""} postal${remplis > 1 ? "aux" : ""} complété${remplis > 1 ? "s" : ""}.` : "", ambigus ? `${ambigus} village${ambigus > 1 ? "s" : ""} à préciser : choisissez le bon code postal.` : "", !remplis && !ambigus ? "Aucune commune trouvée pour les villages sans code postal." : ""].filter(Boolean).join(" "),
    );
  }

  function choisirCodePostal(cle: string, s: SuggestionCommune) {
    setVillages((cur) => cur.map((v, i) => (cleCarte(v, i) === cle ? avecSuggestion(v, s) : v)));
    setCandidatsCp(({ [cle]: _retire, ...reste }) => reste);
  }

  function ouvrirEdition() {
    setEditing(true);
    setInfoCp(null);
    if (!route.isRenfort) void completerCodesPostaux();
  }

  async function save() {
    if (!serviceId) { setError("Affectez d'abord cette tournée à un service."); return; }
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
            .map((v) => ({ ...(v.id ? { id: v.id } : {}), name: v.name.trim(), postal_code: v.postal_code?.trim() || null, notes: v.notes?.trim() || null, ...coordonneesVillage(v), pickup_addresses: v.pickup_addresses ?? [], planned_stops: v.planned_stops ?? [] })),
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
    if (!(await confirmer({ titre: `Supprimer la fiche de la tournée ${route.tourNumber} et ses villages ?`, message: "", action: "Supprimer", danger: true }))) return;
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
  const manquants = villages.filter((v) => v.name.trim() && !codePostalValide(v.postal_code)).length;

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
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={ouvrirEdition}>
            Modifier
          </button>
        )}
      </div>

      {!editing ? (
        <>
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
                {route.villages.map((v, i) => {
                  const trouve = surlignes?.has(cleVillage(route.id, v, i)) ?? false;
                  return (
                  <li key={v.id ?? i} data-village-trouve={trouve || undefined} draggable={canEdit && !route.isRenfort} onDragStart={(e) => { e.dataTransfer.setData("application/x-godac-village", JSON.stringify({ routeId: route.id, village: v })); e.dataTransfer.effectAllowed = "copyMove"; }} className={`flex gap-3 py-2.5 ${trouve ? "-mx-2 rounded-lg bg-gold/25 px-2 ring-2 ring-gold" : ""} ${canEdit && !route.isRenfort ? "cursor-grab active:cursor-grabbing" : ""}`}>
                    <span title={canEdit && !route.isRenfort ? "Glissez ce village vers une autre tournée" : undefined} className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marine text-xs font-semibold tabular-nums text-teal-sur-menu">
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
                  );
                })}
              </ol>
            </>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="label">Service</span>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Choisir un service…</option>
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
              <div className="flex items-baseline justify-between gap-2">
                <p className="label !mb-0">Villages, dans l&apos;ordre de passage</p>
                <span className="text-xs tabular-nums text-navy/55">{villages.length} village{villages.length > 1 ? "s" : ""}</span>
              </div>
              <AjoutVillage
                onAjouter={ajouterDepuisSuggestion}
                onManuel={(name, cp) => ajouterVillage({ name, postal_code: cp, notes: null })}
              />
              {(manquants > 0 || infoCp) && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-orange/[0.08] px-3 py-2 text-sm">
                  {manquants > 0 && (
                    <button type="button" className="btn-secondary !py-2 text-sm" disabled={rechercheCp} onClick={() => void completerCodesPostaux()}>
                      {rechercheCp ? "Recherche…" : `Compléter les codes postaux (${manquants})`}
                    </button>
                  )}
                  {infoCp && <p role="status" className="text-navy/80">{infoCp}</p>}
                </div>
              )}
              {villages.length === 0 ? (
                <p className="rounded-xl border border-dashed border-navy/20 px-3 py-4 text-center text-sm text-navy/60">Aucun village pour l&apos;instant : ajoutez le premier avec le champ ci-dessus.</p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={deposer}
                  accessibility={{
                    screenReaderInstructions: { draggable: "Pour déplacer ce village : Espace pour le saisir, flèches haut et bas pour le déplacer, Espace pour le déposer, Échap pour annuler." },
                    announcements: {
                      onDragStart: () => "Village saisi.",
                      onDragOver: ({ over }) => (over ? "Village au-dessus d'une nouvelle position." : "Hors de la liste."),
                      onDragEnd: ({ over }) => (over ? "Village déposé : nouvel ordre." : "Déplacement annulé."),
                      onDragCancel: () => "Déplacement annulé.",
                    },
                  }}
                >
                  <SortableContext items={villages.map(cleCarte)} strategy={verticalListSortingStrategy}>
                    <ol className="flex flex-col gap-2">
                      {villages.map((v, i) => {
                        const cle = cleCarte(v, i);
                        return (
                          <VillageEditeur
                            key={cle}
                            id={cle}
                            domId={domVillage(i)}
                            village={v}
                            index={i}
                            total={villages.length}
                            autresTournees={allRoutes.filter((r) => r.id !== route.id && !r.isRenfort).map((r) => ({ id: r.id, libelle: `Tournée ${r.tourNumber} · ${r.serviceName ?? "Tous services"}` }))}
                            busy={busy}
                            copie={copyingVillageIndex === i}
                            candidatsCp={candidatsCp[cle]}
                            onChange={(patch) => update(i, patch)}
                            onMove={(delta) => move(i, delta)}
                            onRemove={() => setVillages(villages.filter((_, j) => j !== i))}
                            onCopier={(cible) => void copyVillageToRoute(v, i, cible)}
                            onChoisirCp={(sug) => choisirCodePostal(cle, sug)}
                          />
                        );
                      })}
                    </ol>
                  </SortableContext>
                </DndContext>
              )}
            </>
          )}

          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-navy/[0.08] pt-3">
            <button type="button" className="btn-primary" disabled={busy} onClick={save}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setVillages(route.villages);
                setNotes(route.notes ?? "");
                setServiceId(route.serviceId ?? "");
                setIsRenfort(route.isRenfort);
                setCouverture(new Set(route.renfortVillageIds));
                setCandidatsCp({});
                setInfoCp(null);
                setEditing(false);
              }}
            >
              Annuler
            </button>
            <button type="button" className="ml-auto min-h-[44px] rounded-lg px-2 text-sm font-semibold text-orange-ink underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-ink disabled:opacity-45 sm:min-h-0" disabled={busy} onClick={remove}>
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
  const [serviceFilter, setServiceFilter] = useState("");
  const [onglet, setOnglet] = useState<"fiches" | "carte">("fiches");

  async function create(number: string, service: string | null) {
    setBusy(true);
    setError(null);
    try {
      if (!service) throw new Error("Choisissez un service pour cette tournée.");
      await send("/api/tour-routes", "POST", { tour_number: number.trim(), service_id: service });
      setTourNumber("");
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Recherche de village (nom ou code postal), sans accents ni casse, au fil de la frappe.
  const recherche = useMemo(() => rechercherVillages(routes, query), [routes, query]);
  const visible = routes.filter((r) => (!serviceFilter || (serviceFilter === "__unassigned" ? !r.serviceId : r.serviceId === serviceFilter)) && (!recherche.active || recherche.routeIds.has(r.id)));
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
      {routes.length > 0 && !montreCarte && (
        <div className="flex flex-col gap-1">
          <label className="block">
            <span className="label">Rechercher un village</span>
            <input
              className="input"
              type="search"
              placeholder="Nom du village ou code postal, ex. Voiron ou 38500"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </label>
          {recherche.active && (
            <p className="text-xs text-navy/60" aria-live="polite">
              {recherche.nbVillages > 0
                ? `${recherche.nbVillages} village${recherche.nbVillages > 1 ? "s" : ""} trouvé${recherche.nbVillages > 1 ? "s" : ""} dans ${ordered.length} tournée${ordered.length > 1 ? "s" : ""}, mis en évidence ci-dessous.`
                : ordered.length > 0
                  ? "Aucun village trouvé, mais des numéros de tournée correspondent."
                  : null}
            </p>
          )}
        </div>
      )}
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
                <option value="">Choisir un service…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-primary shrink-0" disabled={busy || !tourNumber.trim() || !serviceId} onClick={() => create(tourNumber, serviceId)}>
              Créer
            </button>
          </div>
          {missingTourNumbers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-navy/60">Tournées du planning sans fiche :</span>
              {missingTourNumbers.map((n) => (
                <button key={n} type="button" className="btn-secondary !px-2.5 !py-1 text-xs" disabled={busy || !serviceId} onClick={() => create(n, serviceId)}>
                  + {n}
                </button>
              ))}
            </div>
          )}
          {renfortReady && <p className="text-xs text-navy/55">Une tournée de renfort se crée comme les autres, puis « Modifier » → « Tournée de renfort ». Elle se planifie avec son numéro, comme toute tournée.</p>}
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
        </Card>
      )}

      {routes.length > 0 && (canSeeMap || avecRenfort || canEdit) && (
        <div className="flex flex-wrap items-end gap-2">
          {canEdit && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-navy/60">Service</span>
              <select className="input !w-auto !py-1.5" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} aria-label="Filtrer les tournées par service">
                <option value="">Tous les services</option>
                <option value="__unassigned">À affecter</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
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
                  if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) router.push(`/exploitation/tournees${e.target.value === today ? "" : `?jour=${e.target.value}`}`);
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
          {ordered.length === 0 ? (
            <p className="text-sm text-navy/60" role={recherche.active ? "status" : undefined}>
              {routes.length === 0 ? (canEdit ? "Aucune tournée renseignée pour le moment." : "Aucune tournée planifiée pour vous d’hier à la semaine prochaine.") : recherche.active ? `Aucun village trouvé pour « ${query.trim()} ».` : "Aucun résultat."}
            </p>
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
                  surlignes={recherche.active ? recherche.villages : undefined}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
