import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { LISTE_PRINCIPALE, type Liste } from "@/lib/colis/listes";
import { normaliserSemaine, type FicheHoraires } from "@/lib/colis/horaires";

export const RUN_FIELDS = "id, name, run_date, status, start_label, start_lat, start_lng, return_to_start, optimized_at, started_at, planned_start";
export const STOP_FIELDS = "id, list_id, position, parcel_code, parcel_count, address, lat, lng, recipient, phone, notes, status, done_at, delivered_place, proof_photo_path, window_start, window_end, kind, proof_code, weight_kg, packages_picked_up, exceptional_pickup, failure_reason";
export const LIST_FIELDS = "id, name, position";

export function aujourdhuiParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

export async function moduleActif(supabase: SupabaseClient, organizationId: string) {
  return isModuleEnabled(supabase, organizationId, "route_optimizer");
}

/** Point de départ par défaut : dépôt du premier service du chauffeur, sinon celui de l'entreprise. */
async function depotDuChauffeur(supabase: SupabaseClient, appUser: AppUser) {
  const [{ data: services }, { data: org }] = await Promise.all([
    supabase.from("user_services").select("services(name, depot_address, depot_lat, depot_lng)").eq("user_id", appUser.id),
    supabase.from("organizations").select("depot_address, depot_lat, depot_lng").eq("id", appUser.organization_id).single(),
  ]);
  const depot = ((services ?? []) as any[]).map((s) => s.services).find((s) => s?.depot_lat && s?.depot_lng);
  if (depot) return { label: depot.depot_address ?? `Dépôt ${depot.name}`, lat: depot.depot_lat, lng: depot.depot_lng };
  if (org?.depot_lat && org?.depot_lng) return { label: org.depot_address ?? "Dépôt", lat: org.depot_lat, lng: org.depot_lng };
  return null;
}

/**
 * Tournées colis du chauffeur à afficher : celles du jour, plus celles
 * des 7 derniers jours qui ne sont pas clôturées.
 */
export async function listerTournees(supabase: SupabaseClient, appUser: AppUser) {
  const today = aujourdhuiParis();
  const semaine = new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("delivery_runs")
    .select(`${RUN_FIELDS}, delivery_stops(parcel_count, status)`)
    .eq("driver_id", appUser.id)
    .gte("run_date", semaine)
    .order("run_date")
    .order("created_at");
  return ((data ?? []) as any[])
    .filter((r) => r.run_date === today || r.status !== "done")
    .map(({ delivery_stops, ...r }) => ({
      ...r,
      nbArrets: (delivery_stops ?? []).length,
      nbColis: (delivery_stops ?? []).reduce((n: number, s: any) => n + s.parcel_count, 0),
      nbRestants: (delivery_stops ?? []).filter((s: any) => s.status === "pending").length,
    }));
}

/**
 * Camion et service du chauffeur ce jour-là d'après le planning (première
 * entrée du jour) — figés sur la tournée pour l'historique, qui filtre sur
 * ce qu'ils étaient ce jour-là et non sur l'affectation actuelle.
 */
export async function planningDuJour(supabase: SupabaseClient, driverId: string, date: string): Promise<{ vehicleId: string | null; serviceId: string | null }> {
  const veille = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString();
  const lendemain = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString();
  const { data } = await supabase
    .from("planning_entries")
    .select("vehicle_id, service_id, start_at")
    .eq("driver_id", driverId)
    .gte("start_at", veille)
    .lt("start_at", lendemain)
    .order("start_at");
  const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" });
  const duJour = ((data ?? []) as { vehicle_id: string | null; service_id: string | null; start_at: string }[]).filter((e) => jour.format(new Date(e.start_at)) === date);
  return { vehicleId: duJour.find((e) => e.vehicle_id)?.vehicle_id ?? null, serviceId: duJour.find((e) => e.service_id)?.service_id ?? null };
}

export async function creerTournee(supabase: SupabaseClient, appUser: AppUser, name: string | null) {
  const date = aujourdhuiParis();
  const [start, jour, { data: liens }] = await Promise.all([
    depotDuChauffeur(supabase, appUser),
    planningDuJour(supabase, appUser.id, date).catch(() => ({ vehicleId: null, serviceId: null })),
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id).limit(1),
  ]);
  const vehicule = jour.vehicleId;
  const service = jour.serviceId ?? ((liens ?? []) as { service_id: string }[])[0]?.service_id ?? null;
  const { count } = await supabase.from("delivery_runs").select("id", { count: "exact", head: true }).eq("driver_id", appUser.id).eq("run_date", date);
  const { data, error } = await supabase
    .from("delivery_runs")
    .insert({
      organization_id: appUser.organization_id,
      driver_id: appUser.id,
      run_date: date,
      name: name?.trim() || `Tournée ${(count ?? 0) + 1}`,
      start_label: start?.label ?? null,
      start_lat: start?.lat ?? null,
      start_lng: start?.lng ?? null,
      ...(vehicule ? { vehicle_id: vehicule } : {}),
      ...(service ? { service_id: service } : {}),
    })
    .select(RUN_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Une tournée du chauffeur connecté (jamais celle d'un autre). */
export async function tourneeParId(supabase: SupabaseClient, appUser: AppUser, id: string) {
  const { data } = await supabase.from("delivery_runs").select(RUN_FIELDS).eq("id", id).eq("driver_id", appUser.id).maybeSingle();
  return data;
}

/** Listes d'une tournée, dans leur ordre. */
export async function listesDeTournee(supabase: SupabaseClient, runId: string): Promise<Liste[]> {
  const { data } = await supabase.from("delivery_lists").select(LIST_FIELDS).eq("run_id", runId).order("position").order("created_at");
  return (data ?? []) as Liste[];
}

/** Une liste, seulement si elle appartient bien à cette tournée (sinon null). */
export async function listeDeLaTournee(supabase: SupabaseClient, runId: string, listId: string): Promise<Liste | null> {
  const { data } = await supabase.from("delivery_lists").select(LIST_FIELDS).eq("id", listId).eq("run_id", runId).maybeSingle();
  return (data as Liste | null) ?? null;
}

/**
 * Première liste explicite d'une tournée : la liste implicite (arrêts sans
 * liste) devient une vraie liste en tête, pour pouvoir la renommer ou en
 * ajouter d'autres. Sans effet si la tournée a déjà des listes.
 */
export async function materialiserListePrincipale(supabase: SupabaseClient, organizationId: string, runId: string, nom?: string | null): Promise<Liste[]> {
  const existantes = await listesDeTournee(supabase, runId);
  if (existantes.length) return existantes;
  const { data, error } = await supabase
    .from("delivery_lists")
    .insert({ organization_id: organizationId, run_id: runId, name: nom?.trim() || LISTE_PRINCIPALE, position: 0 })
    .select(LIST_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  await supabase.from("delivery_stops").update({ list_id: data.id }).eq("run_id", runId).is("list_id", null);
  return [data as Liste];
}

/** Renumérote les listes 0, 1, 2… dans l'ordre donné. */
export async function renumeroterListes(supabase: SupabaseClient, listes: { id: string; position: number }[]) {
  await Promise.all(listes.map((l, i) => (l.position === i ? null : supabase.from("delivery_lists").update({ position: i }).eq("id", l.id))));
}

/** Adresse normalisée pour regrouper plusieurs colis au même arrêt. */
export function cleAdresse(adresse: string): string {
  return adresse
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const HOURS_FIELDS = "id, address_key, label, address, weekly_schedule, notes, updated_at";

/**
 * Fiches horaires de l'entreprise pour ces adresses, indexées par adresse
 * normalisée (cleAdresse). RLS : lecture dans l'entreprise. En cas
 * d'erreur (annuaire indisponible), aucune contrainte horaire.
 */
export async function horairesDesAdresses(supabase: SupabaseClient, organizationId: string, adresses: string[]): Promise<Map<string, FicheHoraires>> {
  const cles = [...new Set(adresses.map(cleAdresse).filter(Boolean))];
  const fiches = new Map<string, FicheHoraires>();
  for (let i = 0; i < cles.length; i += 200) {
    const { data } = await supabase
      .from("delivery_address_hours")
      .select(HOURS_FIELDS)
      .eq("organization_id", organizationId)
      .in("address_key", cles.slice(i, i + 200));
    for (const f of (data ?? []) as FicheHoraires[]) fiches.set(f.address_key, { ...f, weekly_schedule: normaliserSemaine(f.weekly_schedule) });
  }
  return fiches;
}

/** Arrêts complétés de leur fiche horaires (`horaire`, null si l'adresse n'est pas dans l'annuaire). */
export async function avecHoraires<T extends { address: string }>(supabase: SupabaseClient, organizationId: string, stops: T[]): Promise<(T & { horaire: FicheHoraires | null })[]> {
  const fiches = await horairesDesAdresses(
    supabase,
    organizationId,
    stops.map((s) => s.address),
  );
  return stops.map((s) => ({ ...s, horaire: fiches.get(cleAdresse(s.address)) ?? null }));
}
