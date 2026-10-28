import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { memoriserModule, moduleDejaVerifie } from "@/lib/organization/modules-verifies";
import { LISTE_PRINCIPALE, type Liste } from "@/lib/colis/listes";
import { normaliserSemaine, type FicheHoraires } from "@/lib/colis/horaires";
import { lireArrivee, lireDepart, type Arrivee, type Depart } from "@/lib/colis/extremites";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

export const RUN_FIELDS = "id, name, run_date, status, start_label, start_lat, start_lng, return_to_start, optimized_at, started_at, planned_start, service_id";
export const STOP_FIELDS = "id, list_id, position, parcel_code, parcel_count, address, lat, lng, recipient, phone, notes, status, done_at, delivered_place, proof_photo_path, proof_photo_paths, window_start, window_end, kind, proof_code, weight_kg, failure_reason, packages_picked_up, packages_delivered, relay_name";
export const LIST_FIELDS = "id, name, position";

export function aujourdhuiParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

/**
 * Module Tournée colis actif. Réutilise le résultat que garderApi vient de
 * calculer pour cette organisation (lib/organization/modules-verifies.ts) au
 * lieu de relire deux tables ; relit la base sinon.
 */
export async function moduleActif(supabase: SupabaseClient, organizationId: string) {
  const dejaVerifie = moduleDejaVerifie(organizationId, "route_optimizer");
  if (dejaVerifie !== null) return dejaVerifie;
  const actif = await isModuleEnabled(supabase, organizationId, "route_optimizer");
  memoriserModule(organizationId, "route_optimizer", actif);
  return actif;
}

/** Point de départ par défaut : dépôt du premier service du chauffeur, sinon celui de l'entreprise. */
export async function depotDuChauffeur(supabase: SupabaseClient, appUser: Pick<AppUser, "id" | "organization_id">) {
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
 * Dépôt de départ ET de retour d'une tournée : celui de son service
 * (services.depot_*), sinon celui du chauffeur puis de l'entreprise.
 * Toutes les tournées partent du dépôt du service et y reviennent.
 */
export async function depotDuService(
  supabase: SupabaseClient,
  appUser: Pick<AppUser, "id" | "organization_id">,
  serviceId: string | null | undefined,
) {
  if (serviceId) {
    const { data: service } = await supabase.from("services").select("name, depot_address, depot_lat, depot_lng").eq("id", serviceId).eq("organization_id", appUser.organization_id).maybeSingle();
    if (service?.depot_lat && service?.depot_lng) return { label: service.depot_address ?? `Dépôt ${service.name}`, lat: service.depot_lat, lng: service.depot_lng };
  }
  return depotDuChauffeur(supabase, appUser);
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
    // Une tournée clôturée quitte l'écran du jour : elle est dans l'historique.
    .filter((r) => r.status !== "done")
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

export async function creerTournee(
  supabase: SupabaseClient,
  appUser: Pick<AppUser, "id" | "organization_id">,
  name: string | null,
  date: string = aujourdhuiParis(),
  /**
   * Fiche séparée d'une affectation (lib/colis/fiche-du-jour.ts) : véhicule
   * et service de l'affectation, rattachement à son entrée de planning.
   * `fiche_planifiee` n'existe qu'avec la migration 20261023000002.
   */
  affectation: { planningEntryId: string; vehicleId: string | null; serviceId: string | null } | null = null,
) {
  const [jour, { data: liens }] = await Promise.all([
    affectation
      ? Promise.resolve({ vehicleId: affectation.vehicleId, serviceId: affectation.serviceId })
      : planningDuJour(supabase, appUser.id, date).catch(() => ({ vehicleId: null, serviceId: null })),
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id).limit(1),
  ]);
  const vehicule = jour.vehicleId;
  const service = jour.serviceId ?? ((liens ?? []) as { service_id: string }[])[0]?.service_id ?? null;
  // Départ et retour : dépôt du service de la tournée.
  const start = await depotDuService(supabase, appUser, service);
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
      ...(affectation ? { planning_entry_id: affectation.planningEntryId, fiche_planifiee: true } : {}),
    })
    .select(RUN_FIELDS)
    .single();
  // Code conservé (23505) : les appelants reprennent la fiche concurrente.
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}

/** Une tournée du chauffeur connecté (jamais celle d'un autre). */
/**
 * Fiche supplémentaire : le chauffeur a déjà clôturé une autre fiche ce
 * jour-là. Renvoie la date de création de la dernière (les tournées
 * planifiées avant elle y ont été chargées ; seules celles affectées
 * ensuite viennent sur la nouvelle fiche), ou null s'il n'y en a pas.
 */
export async function ficheClotureeDuJour(supabase: SupabaseClient, appUser: Pick<AppUser, "id">, run: { id: string; run_date: string }): Promise<string | null> {
  const { data } = await supabase
    .from("delivery_runs")
    .select("created_at")
    .eq("driver_id", appUser.id)
    .eq("run_date", run.run_date)
    .eq("status", "done")
    .neq("id", run.id)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as { created_at: string }[])[0]?.created_at ?? null;
}

export async function tourneeParId(supabase: SupabaseClient, appUser: AppUser, id: string) {
  const { data } = await supabase.from("delivery_runs").select(RUN_FIELDS).eq("id", id).eq("driver_id", appUser.id).maybeSingle();
  return data;
}

/**
 * Départ et arrivée mémorisés de l'optimisation (migration 20261102000001).
 * `persiste` est faux tant que la migration n'est pas appliquée : l'appareil
 * garde alors le choix lui-même.
 */
export async function lireExtremitesRun(supabase: SupabaseClient, runId: string): Promise<{ depart: Depart | null; arrivee: Arrivee | null; persiste: boolean }> {
  const { data, error } = await supabase.from("delivery_runs").select("optim_depart, optim_arrivee").eq("id", runId).maybeSingle();
  if (error || !data) return { depart: null, arrivee: null, persiste: false };
  const r = data as { optim_depart?: unknown; optim_arrivee?: unknown };
  return { depart: lireDepart(r.optim_depart), arrivee: lireArrivee(r.optim_arrivee), persiste: true };
}

/** Mémorise le choix ; false si les colonnes n'existent pas encore (migration non appliquée). */
export async function ecrireExtremitesRun(supabase: SupabaseClient, runId: string, extremites: { depart?: Depart | null; arrivee?: Arrivee | null }): Promise<boolean> {
  const update: Record<string, unknown> = {};
  if (extremites.depart !== undefined) update.optim_depart = extremites.depart;
  if (extremites.arrivee !== undefined) update.optim_arrivee = extremites.arrivee;
  if (!Object.keys(update).length) return true;
  const { error } = await supabase.from("delivery_runs").update(update).eq("id", runId);
  if (!error) return true;
  if (estSchemaManquant(error)) return false;
  throw new Error(error.message);
}

/**
 * Mode simple de la tournée (migration 20261103000006). `persiste` est faux
 * tant que la migration n'est pas appliquée : l'appareil garde alors le choix.
 */
export async function lireModeSimpleRun(supabase: SupabaseClient, runId: string): Promise<{ modeSimple: boolean; persiste: boolean }> {
  const { data, error } = await supabase.from("delivery_runs").select("mode_simple").eq("id", runId).maybeSingle();
  if (error || !data) return { modeSimple: false, persiste: false };
  return { modeSimple: (data as { mode_simple?: boolean | null }).mode_simple === true, persiste: true };
}

/** Mémorise le mode ; false si la colonne n'existe pas encore (migration non appliquée). */
export async function ecrireModeSimpleRun(supabase: SupabaseClient, runId: string, modeSimple: boolean): Promise<boolean> {
  const { error } = await supabase.from("delivery_runs").update({ mode_simple: modeSimple }).eq("id", runId);
  if (!error) return true;
  if (estSchemaManquant(error)) return false;
  throw new Error(error.message);
}

/** Contacts du client (message, téléphone) de chaque arrêt (migration 20261103000006 ; faux partout si elle n'est pas appliquée). */
export async function avecContacts<T extends { id: string }>(supabase: SupabaseClient, stops: T[]): Promise<(T & { contact_message: boolean; contact_phone: boolean; contact_at: string | null })[]> {
  const contacts = new Map<string, { contact_message: boolean | null; contact_phone: boolean | null; contact_at: string | null }>();
  for (let i = 0; i < stops.length; i += 200) {
    const { data, error } = await supabase.from("delivery_stops").select("id, contact_message, contact_phone, contact_at").in("id", stops.slice(i, i + 200).map((s) => s.id));
    if (error) break;
    for (const c of (data ?? []) as { id: string; contact_message: boolean | null; contact_phone: boolean | null; contact_at: string | null }[]) contacts.set(c.id, c);
  }
  return stops.map((s) => {
    const c = contacts.get(s.id);
    return { ...s, contact_message: c?.contact_message === true, contact_phone: c?.contact_phone === true, contact_at: c?.contact_at ?? null };
  });
}

/**
 * Listes d'une tournée, dans leur ordre, avec le drapeau « hors tournée »
 * (migration 190 ; sans elle, le drapeau est absent et le nom en tient lieu).
 */
export async function listesDeTournee(supabase: SupabaseClient, runId: string): Promise<Liste[]> {
  const lire = (champs: string) => supabase.from("delivery_lists").select(champs).eq("run_id", runId).order("position").order("created_at");
  const avec = await lire(`${LIST_FIELDS}, is_hors_tournee`);
  if (!avec.error) return (avec.data ?? []) as unknown as Liste[];
  return ((await lire(LIST_FIELDS)).data ?? []) as unknown as Liste[];
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
/** Colonnes de la fiche client (migration 20261113000001). */
export const CLIENT_FIELDS =
  "phone, recipient, access_notes, lat, lng, window_start, window_end, service_avg_min, service_samples, delivered_count, failed_count, success_by_hour, failure_reasons, contact_message_count, contact_phone_count, last_delivery_at";

/**
 * Fiches horaires de l'entreprise pour ces adresses, indexées par adresse
 * normalisée (cleAdresse). RLS : lecture dans l'entreprise. En cas
 * d'erreur (annuaire indisponible), aucune contrainte horaire. Les colonnes
 * récentes (origine : migration 190 ; fiche client : migration 20261113000001)
 * sont lues si elles existent, sinon la lecture retombe sur les précédentes.
 */
export async function horairesDesAdresses(supabase: SupabaseClient, organizationId: string, adresses: string[]): Promise<Map<string, FicheHoraires>> {
  const cles = [...new Set(adresses.map(cleAdresse).filter(Boolean))];
  const fiches = new Map<string, FicheHoraires>();
  const colonnes = [`${HOURS_FIELDS}, source, found_at, ${CLIENT_FIELDS}`, `${HOURS_FIELDS}, source, found_at`, HOURS_FIELDS];
  for (let i = 0; i < cles.length; i += 200) {
    const lot = cles.slice(i, i + 200);
    let data: unknown[] | null = null;
    for (const champs of colonnes) {
      const r = await supabase.from("delivery_address_hours").select(champs).eq("organization_id", organizationId).in("address_key", lot);
      if (!r.error) {
        data = r.data as unknown[] | null;
        break;
      }
    }
    for (const f of (data ?? []) as unknown as FicheHoraires[]) fiches.set(f.address_key, { ...f, weekly_schedule: normaliserSemaine(f.weekly_schedule) });
  }
  return fiches;
}

/** Nom du professionnel détecté sur chaque arrêt (migration 190 ; vide si elle n'est pas appliquée). */
export async function avecProfessionnel<T extends { id: string }>(supabase: SupabaseClient, stops: T[]): Promise<(T & { business_name: string | null })[]> {
  const noms = new Map<string, string | null>();
  for (let i = 0; i < stops.length; i += 200) {
    const { data, error } = await supabase.from("delivery_stops").select("id, business_name").in("id", stops.slice(i, i + 200).map((s) => s.id));
    if (error) break;
    for (const s of (data ?? []) as { id: string; business_name: string | null }[]) noms.set(s.id, s.business_name);
  }
  return stops.map((s) => ({ ...s, business_name: noms.get(s.id) ?? null }));
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
