import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { coverageForEntries } from "@/lib/tours/renfort";
import { LISTE_HORS_TOURNEE, cleCommune, communeDepuisAdresse, villagePourAdresse, type VillageRef } from "@/lib/colis/villages";
import type { Point } from "@/lib/colis/optimisation";

/**
 * Tournée colis ↔ planning : tournées du jour du chauffeur, leurs villages
 * (y compris ceux d'un renfort ce jour-là) et rangement d'une adresse dans
 * la liste de son village.
 */

export interface VillageDuJour extends VillageRef {
  position: number;
  route_id: string;
  tour_number: string;
  /** Village emprunté par une tournée de renfort ce jour-là. */
  renfort: boolean;
  planned_stops?: unknown;
  pickup_addresses?: unknown;
}

export interface PassagePlanning {
  planning_entry_id: string;
  tour_number: string;
  start_at: string;
  service_id: string | null;
  service_name: string | null;
  vehicle_id: string | null;
  vehicle: string | null;
  route_id: string | null;
  is_renfort: boolean;
}

const VILLAGE_FIELDS = "id, name, postal_code, lat, lng, position, route_id";

/** Jour de Paris (AAAA-MM-JJ) d'un instant. */
const jourParis = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));

/**
 * Passages planifiés du chauffeur ce jour-là (avec un numéro de tournée) et
 * villages correspondants, dans l'ordre des passages puis des villages.
 * Ne lève jamais : planning indisponible = aucun passage.
 *
 * `affecteesApres` (fiche supplémentaire) : seulement les tournées inscrites
 * au planning après cette date, celles d'avant ayant été chargées sur la
 * fiche déjà clôturée du jour.
 */
export async function planningEtVillages(supabase: SupabaseClient, organizationId: string, driverId: string, date: string, affecteesApres: string | null = null): Promise<{ passages: PassagePlanning[]; villages: VillageDuJour[] }> {
  const veille = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString();
  const lendemain = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString();
  const { data: entries, error } = await supabase
    .from("planning_entries")
    .select("id, tour_number, service_id, vehicle_id, start_at, status, created_at, services(name), vehicles(registration)")
    .eq("organization_id", organizationId)
    .eq("driver_id", driverId)
    .gte("start_at", veille)
    .lt("start_at", lendemain)
    .order("start_at");
  if (error) return { passages: [], villages: [] };
  const duJour = ((entries ?? []) as any[]).filter(
    (e) => e.tour_number && e.status !== "cancelled" && jourParis(e.start_at) === date && (!affecteesApres || Date.parse(e.created_at) > Date.parse(affecteesApres)),
  );
  if (!duJour.length) return { passages: [], villages: [] };

  const numeros = [...new Set(duJour.map((e) => String(e.tour_number)))];
  const { data: routes } = await supabase.from("tour_routes").select("id, tour_number, service_id, is_renfort").eq("organization_id", organizationId).in("tour_number", numeros);
  const routesListe = (routes ?? []) as { id: string; tour_number: string; service_id: string | null; is_renfort?: boolean | null }[];
  const routeDe = (e: any) =>
    routesListe.find((r) => r.tour_number === String(e.tour_number) && e.service_id && r.service_id === e.service_id) ??
    routesListe.find((r) => r.tour_number === String(e.tour_number) && !r.service_id) ??
    routesListe.find((r) => r.tour_number === String(e.tour_number)) ??
    null;

  const passages: PassagePlanning[] = duJour.map((e) => {
    const r = routeDe(e);
    return {
      planning_entry_id: e.id,
      tour_number: String(e.tour_number),
      start_at: e.start_at,
      service_id: e.service_id ?? null,
      service_name: e.services?.name ?? null,
      vehicle_id: e.vehicle_id ?? null,
      vehicle: e.vehicles?.registration ?? null,
      route_id: r?.id ?? null,
      is_renfort: Boolean(r?.is_renfort),
    };
  });

  const villages: VillageDuJour[] = [];
  const vus = new Set<string>();
  const ajouter = (v: any, tour: string, renfort: boolean) => {
    if (!v || vus.has(v.id)) return;
    vus.add(v.id);
    villages.push({ ...v, tour_number: tour, renfort });
  };

  // Villages propres aux tournées planifiées.
  const propres = passages.filter((p) => p.route_id && !p.is_renfort).map((p) => p.route_id!);
  if (propres.length) {
    const { data } = await supabase.from("tour_route_villages").select(VILLAGE_FIELDS).in("route_id", propres).order("position");
    for (const p of passages.filter((x) => x.route_id && !x.is_renfort)) for (const v of ((data ?? []) as any[]).filter((v) => v.route_id === p.route_id)) ajouter(v, p.tour_number, false);
  }

  // Villages empruntés par un renfort ce jour-là (couverture du jour, sinon par défaut).
  const renforts = passages.filter((p) => p.route_id && p.is_renfort);
  if (renforts.length) {
    const [{ data: defauts }, { data: jour }] = await Promise.all([
      supabase.from("tour_route_renfort_villages").select("renfort_route_id, village_id").in("renfort_route_id", renforts.map((r) => r.route_id!)),
      supabase.from("planning_entry_renfort_villages").select("planning_entry_id, village_id").in("planning_entry_id", renforts.map((r) => r.planning_entry_id)),
    ]);
    const couverture = coverageForEntries(
      renforts.map((r) => ({ planningEntryId: r.planning_entry_id, renfortRouteId: r.route_id!, tourNumber: r.tour_number })),
      ((defauts ?? []) as { renfort_route_id: string; village_id: string }[]).map((l) => ({ renfortRouteId: l.renfort_route_id, villageId: l.village_id })),
      ((jour ?? []) as { planning_entry_id: string; village_id: string }[]).map((l) => ({ planningEntryId: l.planning_entry_id, villageId: l.village_id })),
    );
    const ids = [...new Set([...couverture.values()].flatMap((c) => c.villageIds))];
    if (ids.length) {
      const { data } = await supabase.from("tour_route_villages").select(VILLAGE_FIELDS).in("id", ids);
      const parId = new Map(((data ?? []) as any[]).map((v) => [v.id, v]));
      for (const r of renforts) for (const id of couverture.get(r.planning_entry_id)?.villageIds ?? []) ajouter(parId.get(id), r.tour_number, true);
    }
  }
  return { passages, villages };
}

/** Villages d'une tournée-modèle (choix manuel sans planning). */
export async function villagesDeRoute(supabase: SupabaseClient, routeId: string): Promise<VillageDuJour[]> {
  const [{ data: route }, { data }] = await Promise.all([
    supabase.from("tour_routes").select("tour_number").eq("id", routeId).maybeSingle(),
    supabase.from("tour_route_villages").select(VILLAGE_FIELDS).eq("route_id", routeId).order("position"),
  ]);
  return ((data ?? []) as any[]).map((v) => ({ ...v, tour_number: route?.tour_number ?? "", renfort: false }));
}

interface ListeVillage {
  id: string;
  name: string;
  position: number;
  village_id: string | null;
  is_hors_tournee: boolean;
}

/** Listes de la tournée avec leur village (repli sans les colonnes si la migration 190 n'est pas appliquée). */
export async function listesAvecVillages(supabase: SupabaseClient, runId: string): Promise<{ listes: ListeVillage[]; migration: boolean }> {
  const { data, error } = await supabase.from("delivery_lists").select("id, name, position, village_id, is_hors_tournee").eq("run_id", runId).order("position");
  if (!error) return { listes: (data ?? []) as ListeVillage[], migration: true };
  const { data: simples } = await supabase.from("delivery_lists").select("id, name, position").eq("run_id", runId).order("position");
  return { listes: ((simples ?? []) as { id: string; name: string; position: number }[]).map((l) => ({ ...l, village_id: null, is_hors_tournee: false })), migration: false };
}

/**
 * Crée les listes manquantes pour ces villages (une par village, dans leur
 * ordre, après les listes existantes). Une liste existante du même nom
 * (créée avant la migration 190) est rattachée au village.
 */
export async function assurerListesVillages(supabase: SupabaseClient, appUser: Pick<AppUser, "organization_id">, runId: string, villages: VillageRef[]): Promise<ListeVillage[]> {
  const { listes, migration } = await listesAvecVillages(supabase, runId);
  let position = listes.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  for (const v of villages) {
    if (listes.some((l) => l.village_id === v.id)) continue;
    const homonyme = listes.find((l) => !l.village_id && !l.is_hors_tournee && cleCommune(l.name) === cleCommune(v.name));
    if (homonyme) {
      if (migration) {
        await supabase.from("delivery_lists").update({ village_id: v.id }).eq("id", homonyme.id);
        homonyme.village_id = v.id;
      }
      continue;
    }
    const { data, error } = await supabase
      .from("delivery_lists")
      .insert({ organization_id: appUser.organization_id, run_id: runId, name: v.name.slice(0, 60), position, ...(migration ? { village_id: v.id } : {}) })
      .select("id, name, position")
      .single();
    if (error) throw new Error(`Impossible de créer la liste du village « ${v.name} » : ${error.message}`);
    listes.push({ ...(data as { id: string; name: string; position: number }), village_id: migration ? v.id : null, is_hors_tournee: false });
    position++;
  }
  return listes;
}

/**
 * Liste où ranger une adresse ajoutée à la tournée (scan, photo, saisie,
 * import) :
 * - tournée avec des listes-villages : village par commune ou proximité,
 *   sinon « Hors tournée » (créée au besoin) ;
 * - tournée sans villages (créée à la main) : liste de la commune, créée au
 *   besoin (comportement historique) ; null si la commune est inconnue.
 * `cache` : listes déjà lues (import en série), mis à jour en place.
 */
export async function listePourAdresse(
  supabase: SupabaseClient,
  appUser: Pick<AppUser, "organization_id">,
  runId: string,
  adresse: { texte: string; commune?: string | null; codePostal?: string | null; point?: Point | null },
  cache?: { listes: ListeVillage[]; villages: VillageRef[]; migration: boolean },
): Promise<{ listId: string | null; raison: "commune" | "proximite" | "hors_tournee" | "commune_libre" | null; nom: string | null }> {
  const ctx = cache ?? (await chargerContexteRangement(supabase, runId));
  const lu = communeDepuisAdresse(adresse.texte);
  const commune = adresse.commune || lu.commune;
  const codePostal = adresse.codePostal || lu.codePostal;

  if (ctx.villages.length) {
    const r = villagePourAdresse({ commune, codePostal, point: adresse.point ?? null }, ctx.villages);
    if (r.village) {
      const l = ctx.listes.find((x) => x.village_id === r.village!.id);
      if (l) return { listId: l.id, raison: r.raison, nom: l.name };
    }
    let hors = ctx.listes.find((l) => l.is_hors_tournee) ?? ctx.listes.find((l) => cleCommune(l.name) === cleCommune(LISTE_HORS_TOURNEE));
    if (!hors) {
      const position = ctx.listes.reduce((m, l) => Math.max(m, l.position), -1) + 1;
      const { data, error } = await supabase
        .from("delivery_lists")
        .insert({ organization_id: appUser.organization_id, run_id: runId, name: LISTE_HORS_TOURNEE, position, ...(ctx.migration ? { is_hors_tournee: true } : {}) })
        .select("id, name, position")
        .single();
      if (error) return { listId: null, raison: null, nom: null };
      hors = { ...(data as { id: string; name: string; position: number }), village_id: null, is_hors_tournee: true };
      ctx.listes.push(hors);
    }
    return { listId: hors.id, raison: "hors_tournee", nom: hors.name };
  }

  if (!commune) return { listId: null, raison: null, nom: null };
  const existante = ctx.listes.find((l) => cleCommune(l.name) === cleCommune(commune));
  if (existante) return { listId: existante.id, raison: "commune_libre", nom: existante.name };
  const position = ctx.listes.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  const { data, error } = await supabase
    .from("delivery_lists")
    .insert({ organization_id: appUser.organization_id, run_id: runId, name: commune.slice(0, 60), position })
    .select("id, name, position")
    .single();
  if (error) return { listId: null, raison: null, nom: null };
  const creee = { ...(data as { id: string; name: string; position: number }), village_id: null, is_hors_tournee: false };
  ctx.listes.push(creee);
  return { listId: creee.id, raison: "commune_libre", nom: creee.name };
}

/** Listes et villages (avec coordonnées) d'une tournée, pour ranger une série d'adresses. */
export async function chargerContexteRangement(supabase: SupabaseClient, runId: string): Promise<{ listes: ListeVillage[]; villages: VillageRef[]; migration: boolean }> {
  const { listes, migration } = await listesAvecVillages(supabase, runId);
  const ids = listes.map((l) => l.village_id).filter((x): x is string => Boolean(x));
  if (!ids.length) return { listes, villages: [], migration };
  const { data } = await supabase.from("tour_route_villages").select("id, name, postal_code, lat, lng").in("id", ids);
  return { listes, villages: (data ?? []) as VillageRef[], migration };
}
