/**
 * Historique des tournées colis : filtres (période, service, chauffeur,
 * camion) lus dans l'URL, puis une ligne par tournée avec ses compteurs.
 *
 * Accès : la RLS de delivery_runs limite déjà au chauffeur lui-même ou à
 * l'encadrement de l'entreprise ; pour un chauffeur on filtre en plus sur
 * ses propres tournées. Les tournées sont purgées 30 jours après leur
 * date (lib/retention/purge.ts) : l'historique couvre donc ~30 jours.
 *
 * Camion : delivery_runs.vehicle_id (renseigné à la création d'après le
 * planning du jour), sinon retrouvé dans planning_entries (même chauffeur,
 * même jour de Paris) pour les tournées plus anciennes.
 *
 * Les fonctions de filtrage / agrégation sont pures (testées dans
 * lib/colis/__tests__/historique.test.ts) ; historiqueTournees() fait les
 * requêtes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { longueurParcours, type Point } from "@/lib/colis/optimisation";
import { LISTE_PRINCIPALE, ordonnerParListe, type Liste } from "@/lib/colis/listes";

export const PAR_PAGE = 25;
/** Période proposée par défaut : les 30 derniers jours (aujourd'hui compris). */
export const JOURS_PAR_DEFAUT = 30;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FiltresHistorique {
  du: string;
  au: string;
  service: string | null;
  chauffeur: string | null;
  camion: string | null;
  page: number;
}

/** Jour YYYY-MM-DD décalé de `n` jours. */
export function decalerJour(jour: string, n: number): string {
  const [y, m, d] = jour.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function jourValide(v: string | undefined | null): string | null {
  if (!v || !JOUR.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/**
 * Filtres depuis les paramètres d'URL (?du=&au=&service=&chauffeur=&camion=&page=).
 * Valeurs invalides ignorées, période par défaut : 30 derniers jours,
 * bornes inversées remises dans l'ordre.
 */
export function lireFiltres(params: Record<string, string | string[] | undefined>, aujourdhui: string): FiltresHistorique {
  const un = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = (k: string) => {
    const v = un(k);
    return v && UUID.test(v) ? v : null;
  };
  let au = jourValide(un("au")) ?? aujourdhui;
  let du = jourValide(un("du")) ?? decalerJour(au, -(JOURS_PAR_DEFAUT - 1));
  if (du > au) [du, au] = [au, du];
  const page = Math.max(1, Math.floor(Number(un("page"))) || 1);
  return { du, au, service: id("service"), chauffeur: id("chauffeur"), camion: id("camion"), page };
}

/** Paramètres d'URL d'un jeu de filtres (période par défaut omise : liens courts). */
export function versParams(f: Partial<FiltresHistorique>, aujourdhui: string, extra: Record<string, string | null | undefined> = {}): URLSearchParams {
  const q = new URLSearchParams({ onglet: "historique" });
  const defaut = lireFiltres({}, aujourdhui);
  if (f.du && f.du !== defaut.du) q.set("du", f.du);
  if (f.au && f.au !== defaut.au) q.set("au", f.au);
  if (f.service) q.set("service", f.service);
  if (f.chauffeur) q.set("chauffeur", f.chauffeur);
  if (f.camion) q.set("camion", f.camion);
  if (f.page && f.page > 1) q.set("page", String(f.page));
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q;
}

/** Jour de Paris (YYYY-MM-DD) d'un instant ISO. */
export function jourParis(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));
}

export interface EntreePlanning {
  driver_id: string | null;
  vehicle_id: string | null;
  service_id?: string | null;
  start_at: string;
}

/**
 * Service d'une tournée tel qu'il était ce jour-là : celui figé sur la
 * tournée, sinon celui du planning du chauffeur ce jour-là — jamais son
 * affectation actuelle.
 */
export function serviceDeTournee(run: { driver_id: string; run_date: string; service_id?: string | null }, planning: EntreePlanning[]): string | null {
  if (run.service_id) return run.service_id;
  const e = planning
    .filter((p) => p.driver_id === run.driver_id && p.service_id && jourParis(p.start_at) === run.run_date)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  return e?.service_id ?? null;
}

/**
 * Camion d'une tournée : celui enregistré sur la tournée, sinon le premier
 * véhicule du planning du chauffeur ce jour-là (heure de Paris).
 */
export function camionDeTournee(run: { driver_id: string; run_date: string; vehicle_id?: string | null }, planning: EntreePlanning[]): string | null {
  if (run.vehicle_id) return run.vehicle_id;
  const e = planning
    .filter((p) => p.driver_id === run.driver_id && p.vehicle_id && jourParis(p.start_at) === run.run_date)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  return e?.vehicle_id ?? null;
}

export interface LigneLegere {
  id: string;
  driver_id: string;
  run_date: string;
  camion: string | null;
  services: string[];
}

/** Filtres service / chauffeur / camion appliqués aux tournées de la période. */
export function filtrerLignes<T extends LigneLegere>(lignes: T[], f: Pick<FiltresHistorique, "service" | "chauffeur" | "camion">): T[] {
  return lignes.filter((l) => (!f.chauffeur || l.driver_id === f.chauffeur) && (!f.service || l.services.includes(f.service)) && (!f.camion || l.camion === f.camion));
}

/** Page `page` (1, 2…) de `parPage` éléments ; la page est ramenée dans les bornes. */
export function paginer<T>(items: T[], page: number, parPage = PAR_PAGE): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(items.length / parPage));
  const p = Math.min(Math.max(1, page), pages);
  return { items: items.slice((p - 1) * parPage, p * parPage), page: p, pages, total: items.length };
}

export interface ArretHistorique {
  status: string;
  parcel_count: number;
  done_at: string | null;
  lat: number | string | null;
  lng: number | string | null;
  position: number;
  list_id?: string | null;
}

export interface Compteurs {
  arrets: number;
  livres: number;
  echecs: number;
  colis: number;
  /** Dernier arrêt fait (livré ou échec). */
  fin: string | null;
  /** Distance estimée (vol d'oiseau × facteur routier) des arrêts faits, depuis le dépôt ; null sans coordonnées. */
  km: number | null;
}

/** Compteurs d'une tournée passée. */
export function agregerArrets(
  arrets: ArretHistorique[],
  depot: Point | null,
  retour: boolean,
): Compteurs {
  const faits = arrets.filter((s) => s.status !== "pending");
  const fin = faits.reduce<string | null>((m, s) => (s.done_at && (!m || s.done_at > m) ? s.done_at : m), null);
  // Trajet réellement fait : arrêts faits dans l'ordre où ils l'ont été.
  const pts = faits
    .filter((s) => s.lat !== null && s.lng !== null)
    .sort((a, b) => (a.done_at ?? "").localeCompare(b.done_at ?? "") || a.position - b.position)
    .map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }));
  const km = pts.length ? Math.round(longueurParcours(depot, pts, retour && faits.length === arrets.length) * 10) / 10 : null;
  return {
    arrets: arrets.length,
    livres: arrets.filter((s) => s.status === "delivered").length,
    echecs: arrets.filter((s) => s.status === "failed").length,
    colis: arrets.reduce((n, s) => n + s.parcel_count, 0),
    fin,
    km,
  };
}

export interface LigneHistorique extends LigneLegere, Compteurs {
  nom: string | null;
  statut: "loading" | "in_progress" | "done";
  chauffeur: string;
  nomsServices: string[];
  immatriculation: string | null;
  listes: number;
  debut: string | null;
}

export interface Option {
  id: string;
  label: string;
}

export interface Historique {
  filtres: FiltresHistorique;
  lignes: LigneHistorique[];
  page: number;
  pages: number;
  total: number;
  services: Option[];
  chauffeurs: Option[] | null;
  camions: Option[];
  erreur: string | null;
}

/**
 * Tournées de la période, filtrées et paginées. `toutes` : encadrement
 * (toutes les tournées de l'entreprise) ; sinon celles de `userId` seulement.
 */
export async function historiqueTournees(supabase: SupabaseClient, userId: string, toutes: boolean, filtres: FiltresHistorique): Promise<Historique> {
  let q = supabase
    .from("delivery_runs")
    .select("id, name, run_date, status, driver_id, vehicle_id, service_id, started_at, start_lat, start_lng, return_to_start, created_at")
    .gte("run_date", filtres.du)
    .lte("run_date", filtres.au)
    .order("run_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5000);
  if (!toutes) q = q.eq("driver_id", userId);
  else if (filtres.chauffeur) q = q.eq("driver_id", filtres.chauffeur);

  const [{ data: runs, error }, { data: services }, { data: vehicules }, { data: chauffeurs }] = await Promise.all([
    q,
    supabase.from("services").select("id, name").order("name"),
    supabase.from("vehicles").select("id, registration").order("registration"),
    toutes
      ? supabase.from("users").select("id, full_name").in("role", ["chauffeur", "manager_chauffeur"]).order("full_name")
      : Promise.resolve({ data: null as { id: string; full_name: string }[] | null }),
  ]);
  const listeRuns = (runs ?? []) as {
    id: string;
    name: string | null;
    run_date: string;
    status: LigneHistorique["statut"];
    driver_id: string;
    vehicle_id: string | null;
    service_id: string | null;
    started_at: string | null;
    start_lat: number | null;
    start_lng: number | null;
    return_to_start: boolean;
  }[];

  const driverIds = [...new Set(listeRuns.map((r) => r.driver_id))];
  const sansCamion = listeRuns.filter((r) => !r.vehicle_id || !r.service_id);
  const [{ data: noms }, { data: planning }] = await Promise.all([
    driverIds.length ? supabase.from("users").select("id, full_name").in("id", driverIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    sansCamion.length
      ? supabase
          .from("planning_entries")
          .select("driver_id, vehicle_id, service_id, start_at")
          .in("driver_id", [...new Set(sansCamion.map((r) => r.driver_id))])
          .gte("start_at", `${decalerJour(filtres.du, -1)}T00:00:00Z`)
          .lt("start_at", `${decalerJour(filtres.au, 2)}T00:00:00Z`)
          .limit(10000)
      : Promise.resolve({ data: [] as EntreePlanning[] }),
  ]);

  const nomChauffeur = new Map(((noms ?? []) as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name]));
  const nomService = new Map(((services ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
  const immat = new Map(((vehicules ?? []) as { id: string; registration: string }[]).map((v) => [v.id, v.registration]));

  const legeres = listeRuns.map((r) => ({
    ...r,
    camion: camionDeTournee(r, (planning ?? []) as EntreePlanning[]),
    services: [serviceDeTournee(r, (planning ?? []) as EntreePlanning[])].filter((x): x is string => Boolean(x)),
  }));
  const { items, page, pages, total } = paginer(filtrerLignes(legeres, filtres), filtres.page);

  // Compteurs seulement pour les tournées de la page affichée.
  const ids = items.map((r) => r.id);
  const [{ data: arrets }, { data: listes }] = await Promise.all([
    ids.length
      ? supabase.from("delivery_stops").select("run_id, status, parcel_count, done_at, lat, lng, position").in("run_id", ids)
      : Promise.resolve({ data: [] as (ArretHistorique & { run_id: string })[] }),
    ids.length ? supabase.from("delivery_lists").select("run_id").in("run_id", ids) : Promise.resolve({ data: [] as { run_id: string }[] }),
  ]);
  const arretsDe = new Map<string, ArretHistorique[]>();
  for (const s of (arrets ?? []) as (ArretHistorique & { run_id: string })[]) arretsDe.set(s.run_id, [...(arretsDe.get(s.run_id) ?? []), s]);
  const nbListes = new Map<string, number>();
  for (const l of (listes ?? []) as { run_id: string }[]) nbListes.set(l.run_id, (nbListes.get(l.run_id) ?? 0) + 1);

  const lignes: LigneHistorique[] = items.map((r) => {
    const depot = r.start_lat !== null && r.start_lng !== null ? { lat: Number(r.start_lat), lng: Number(r.start_lng) } : null;
    return {
      id: r.id,
      driver_id: r.driver_id,
      run_date: r.run_date,
      camion: r.camion,
      services: r.services,
      nom: r.name,
      statut: r.status,
      chauffeur: nomChauffeur.get(r.driver_id) ?? "—",
      nomsServices: r.services.map((s) => nomService.get(s)).filter((s): s is string => Boolean(s)),
      immatriculation: r.camion ? (immat.get(r.camion) ?? null) : null,
      // Sans liste explicite, la tournée a sa liste implicite.
      listes: Math.max(1, nbListes.get(r.id) ?? 0),
      debut: r.started_at,
      ...agregerArrets(arretsDe.get(r.id) ?? [], depot, r.return_to_start),
    };
  });

  return {
    filtres: { ...filtres, page },
    lignes,
    page,
    pages,
    total,
    services: ((services ?? []) as { id: string; name: string }[]).map((s) => ({ id: s.id, label: s.name })),
    // Chauffeurs actuels + ceux qui ont roulé sur la période (même partis ou changés de rôle depuis).
    chauffeurs: chauffeurs
      ? [
          ...new Map(
            [...(chauffeurs as { id: string; full_name: string }[]).map((u) => [u.id, u.full_name] as const), ...nomChauffeur.entries()].map(([id, label]) => [id, { id, label }]),
          ).values(),
        ].sort((a, b) => a.label.localeCompare(b.label, "fr"))
      : null,
    camions: ((vehicules ?? []) as { id: string; registration: string }[]).map((v) => ({ id: v.id, label: v.registration })),
    erreur: error?.message ?? null,
  };
}

export interface ArretDetail {
  id: string;
  list_id: string | null;
  position: number;
  parcel_code: string | null;
  parcel_count: number;
  address: string;
  recipient: string | null;
  status: "pending" | "delivered" | "failed";
  done_at: string | null;
  delivered_place: string | null;
  proof_photo_path: string | null;
  notes: string | null;
  kind?: string | null;
  proof_code?: string | null;
  weight_kg?: number | string | null;
  failure_reason?: string | null;
  lat: number | string | null;
  lng: number | string | null;
}

/** Détail en lecture seule d'une tournée de l'historique (null si inaccessible). */
export async function detailTournee(supabase: SupabaseClient, userId: string, toutes: boolean, id: string) {
  if (!UUID.test(id)) return null;
  let q = supabase.from("delivery_runs").select("id, name, run_date, status, driver_id, started_at, start_label, start_lat, start_lng").eq("id", id);
  if (!toutes) q = q.eq("driver_id", userId);
  const { data: run } = await q.maybeSingle();
  if (!run) return null;
  const [{ data: stops }, { data: listes }, { data: chauffeur }] = await Promise.all([
    supabase
      .from("delivery_stops")
      .select("id, list_id, position, parcel_code, parcel_count, address, recipient, status, done_at, delivered_place, proof_photo_path, notes, kind, proof_code, weight_kg, failure_reason, lat, lng")
      .eq("run_id", id)
      .order("position")
      .order("created_at"),
    supabase.from("delivery_lists").select("id, name, position").eq("run_id", id).order("position"),
    supabase.from("users").select("full_name").eq("id", run.driver_id).maybeSingle(),
  ]);
  const ls = (listes ?? []) as Liste[];
  const nom = new Map(ls.map((l) => [l.id, l.name]));
  const arretsOrdonnes = ordonnerParListe((stops ?? []) as ArretDetail[], ls).map((s) => ({ ...s, liste: (s.list_id && nom.get(s.list_id)) || LISTE_PRINCIPALE }));
  // L’historique reflète l’ordre réel de passage : heure de clôture de l’arrêt,
  // puis position prévue en secours. Les arrêts non clôturés restent à la fin.
  const arrets = arretsOrdonnes.sort((a, b) => {
    const aFait = a.status !== "pending";
    const bFait = b.status !== "pending";
    if (aFait !== bFait) return aFait ? -1 : 1;
    if (aFait && bFait && a.done_at && b.done_at && a.done_at !== b.done_at) return a.done_at.localeCompare(b.done_at);
    if (aFait && !a.done_at && b.done_at) return 1;
    if (aFait && a.done_at && !b.done_at) return -1;
    return a.position - b.position;
  });
  return { run: run as { id: string; name: string | null; run_date: string; status: string; started_at: string | null; start_label: string | null; start_lat: number | null; start_lng: number | null }, chauffeur: chauffeur?.full_name ?? "—", arrets, listes: ls.length };
}
