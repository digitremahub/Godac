import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { coverageForEntries } from "@/lib/tours/renfort";
import { LISTE_HORS_TOURNEE, LISTE_REPORTES, cleCommune, communeDepuisAdresse, estListeReportee, rangerAdresse, type VillageRef } from "@/lib/colis/villages";
import type { Point } from "@/lib/colis/optimisation";
import { fusionDeLEntree, type FusionChargee } from "@/lib/planning/fusion-serveur";
import { elementDuVillage, visiblesPour, type VisibleDuChauffeur } from "@/lib/planning/fusion";

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
 *
 * `runId` (fiche donnée) : avec la migration 20261023000002, seulement les
 * entrées que porte cette fiche (séparée : une ; reliée : plusieurs ; libre
 * sans planning : aucune, le chauffeur choisit une tournée-modèle). Sans la
 * migration : toutes les entrées du jour (ancien fonctionnement, `affecteesApres`).
 */
export async function planningEtVillages(supabase: SupabaseClient, organizationId: string, driverId: string, date: string, affecteesApres: string | null = null, runId: string | null = null): Promise<{ passages: PassagePlanning[]; villages: VillageDuJour[] }> {
  const veille = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString();
  const lendemain = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString();
  const lire = (champs: string) =>
    supabase
      .from("planning_entries")
      .select(champs)
      .eq("organization_id", organizationId)
      .eq("driver_id", driverId)
      .gte("start_at", veille)
      .lt("start_at", lendemain)
      .order("start_at");
  const CHAMPS = "id, tour_number, service_id, vehicle_id, start_at, status, created_at, services(name), vehicles(registration)";
  let parFiche = false;
  let res = runId ? await lire(`${CHAMPS}, delivery_run_id`) : await lire(CHAMPS);
  if (runId && !res.error) parFiche = true;
  else if (runId) res = await lire(CHAMPS); // colonne absente : ancien fonctionnement
  const { data: entries, error } = res;
  if (error) return { passages: [], villages: [] };
  let origine: string | null = null;
  if (parFiche) {
    const { data: fiche } = await supabase.from("delivery_runs").select("planning_entry_id").eq("id", runId!).maybeSingle();
    origine = (fiche as { planning_entry_id?: string | null } | null)?.planning_entry_id ?? null;
  }
  const duJour = ((entries ?? []) as any[]).filter(
    (e) =>
      e.tour_number && e.status !== "cancelled" && jourParis(e.start_at) === date &&
      (parFiche
        ? e.delivery_run_id === runId || (origine !== null && e.id === origine)
        : !affecteesApres || Date.parse(e.created_at) > Date.parse(affecteesApres)),
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

  // Tournées fusionnées (lundi, migration 20261105000001) : villages répartis entre les chauffeurs.
  // Le chauffeur ne voit que les siens et ceux encore « À attribuer » (lib/planning/fusion.ts › visiblesPour).
  const fusions = new Map<string, { fusion: FusionChargee; visibles: VisibleDuChauffeur }>();
  for (const p of passages) {
    const fusion = await fusionDeLEntree(organizationId, { id: p.planning_entry_id, service_id: p.service_id, tour_number: p.tour_number, start_at: p.start_at });
    if (fusion) fusions.set(p.planning_entry_id, { fusion, visibles: visiblesPour(driverId, fusion.elements, fusion.lignes) });
  }

  // Villages propres aux tournées planifiées.
  const propres = passages.filter((p) => p.route_id && !p.is_renfort).map((p) => p.route_id!);
  if (propres.length) {
    const { data } = await supabase.from("tour_route_villages").select(VILLAGE_FIELDS).in("route_id", propres).order("position");
    for (const p of passages.filter((x) => x.route_id && !x.is_renfort)) {
      const f = fusions.get(p.planning_entry_id);
      for (const v of ((data ?? []) as any[]).filter((v) => v.route_id === p.route_id)) {
        const element = f ? elementDuVillage(v, f.fusion.elements.villages) : null;
        if (f && element && !f.visibles.villageIds.has(element.cle)) continue;
        ajouter(v, p.tour_number, false);
      }
    }
  }

  // Villages des tournées d'origine d'une fusion qui lui reviennent (hors ceux de sa propre tournée, déjà vus par nom).
  const nomsVus = new Set(villages.map((v) => cleCommune(v.name)));
  for (const p of passages) {
    const f = fusions.get(p.planning_entry_id);
    if (!f || !f.visibles.villageIds.size) continue;
    const { data } = await supabase.from("tour_route_villages").select(VILLAGE_FIELDS).in("id", [...f.visibles.villageIds]).order("position");
    for (const v of (data ?? []) as any[]) {
      if (nomsVus.has(cleCommune(v.name))) continue;
      nomsVus.add(cleCommune(v.name));
      ajouter(v, p.tour_number, false);
    }
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

export interface ListeVillage {
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
 * Liste existante de ce nom parmi celles de la tournée (hors « Reportés »,
 * hors listes-villages), sinon créée à la fin. `horsTournee` : liste signalée hors tournée.
 */
async function assurerListeNommee(
  supabase: SupabaseClient,
  appUser: Pick<AppUser, "organization_id">,
  runId: string,
  ctx: { listes: ListeVillage[]; migration: boolean },
  nom: string,
  horsTournee: boolean,
): Promise<ListeVillage | null> {
  const cle = cleCommune(nom);
  const existante = ctx.listes.find((l) => !l.village_id && cleCommune(l.name) === cle && (horsTournee ? !estListeReportee(l) : true));
  if (existante) return existante;
  const position = ctx.listes.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  const { data, error } = await supabase
    .from("delivery_lists")
    .insert({ organization_id: appUser.organization_id, run_id: runId, name: nom.slice(0, 60), position, ...(ctx.migration && horsTournee ? { is_hors_tournee: true } : {}) })
    .select("id, name, position")
    .single();
  if (error) return null;
  const creee = { ...(data as { id: string; name: string; position: number }), village_id: null, is_hors_tournee: horsTournee };
  ctx.listes.push(creee);
  return creee;
}

/** Liste « Reportés » de la tournée (créée au besoin, à la fin) : les adresses des villages décochés y sont mises de côté. */
export function assurerListeReportes(supabase: SupabaseClient, appUser: Pick<AppUser, "organization_id">, runId: string, ctx: { listes: ListeVillage[]; migration: boolean }) {
  return assurerListeNommee(supabase, appUser, runId, ctx, LISTE_REPORTES, false);
}

/**
 * Liste où ranger une adresse ajoutée à la tournée (scan, photo, saisie,
 * import) :
 * - tournée avec des listes-villages : village par commune ou proximité ;
 *   sinon la liste hors tournée de SA commune (une par commune, créée au
 *   besoin) ; sans commune lisible, « Hors tournée » ;
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
): Promise<{ listId: string | null; raison: "commune" | "proximite" | "hors_tournee" | "commune_libre" | null; nom: string | null; horsTournee: boolean }> {
  const ctx = cache ?? (await chargerContexteRangement(supabase, runId));
  const lu = communeDepuisAdresse(adresse.texte);
  const commune = adresse.commune || lu.commune;

  if (ctx.villages.length) {
    const r = rangerAdresse({ texte: adresse.texte, commune: adresse.commune, codePostal: adresse.codePostal, point: adresse.point ?? null }, ctx.villages);
    if (r.type === "village") {
      const l = ctx.listes.find((x) => x.village_id === r.village.id);
      if (l) return { listId: l.id, raison: r.raison, nom: l.name, horsTournee: false };
    }
    const hors = await assurerListeNommee(supabase, appUser, runId, ctx, r.type === "commune" ? r.nom : LISTE_HORS_TOURNEE, true);
    if (!hors) return { listId: null, raison: null, nom: null, horsTournee: false };
    return { listId: hors.id, raison: "hors_tournee", nom: hors.name, horsTournee: true };
  }

  if (!commune) return { listId: null, raison: null, nom: null, horsTournee: false };
  const existante = ctx.listes.find((l) => cleCommune(l.name) === cleCommune(commune));
  if (existante) return { listId: existante.id, raison: "commune_libre", nom: existante.name, horsTournee: false };
  const position = ctx.listes.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  const { data, error } = await supabase
    .from("delivery_lists")
    .insert({ organization_id: appUser.organization_id, run_id: runId, name: commune.slice(0, 60), position })
    .select("id, name, position")
    .single();
  if (error) return { listId: null, raison: null, nom: null, horsTournee: false };
  const creee = { ...(data as { id: string; name: string; position: number }), village_id: null, is_hors_tournee: false };
  ctx.listes.push(creee);
  return { listId: creee.id, raison: "commune_libre", nom: creee.name, horsTournee: false };
}

/** Listes et villages (avec coordonnées) d'une tournée, pour ranger une série d'adresses. */
export async function chargerContexteRangement(supabase: SupabaseClient, runId: string): Promise<{ listes: ListeVillage[]; villages: VillageRef[]; migration: boolean }> {
  const { listes, migration } = await listesAvecVillages(supabase, runId);
  const ids = listes.map((l) => l.village_id).filter((x): x is string => Boolean(x));
  if (!ids.length) return { listes, villages: [], migration };
  const { data } = await supabase.from("tour_route_villages").select("id, name, postal_code, lat, lng").in("id", ids);
  return { listes, villages: (data ?? []) as VillageRef[], migration };
}
