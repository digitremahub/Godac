import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { normaliserNomRelais } from "@/lib/colis/relais";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { assurerListesVillages, planningEtVillages } from "@/lib/colis/villages-serveur";
import { fusionDeLEntree } from "@/lib/planning/fusion-serveur";
import { cleRamasse, elementDuVillage, visiblesPour } from "@/lib/planning/fusion";
import { cleCommune } from "@/lib/colis/villages";
import { cleAdresse, creerTournee, ficheClotureeDuJour, RUN_FIELDS } from "@/lib/colis/serveur";
import {
  choixRequis,
  entreesDeLaFiche,
  entreesDuJour,
  entreesOrphelines,
  ficheARelier,
  heureParis,
  nomFiche,
  type ChoixRequis,
  type EntreeDuJour,
  type FicheDuJour,
  type Regroupement,
} from "@/lib/colis/fiches-affectation";

export type Conducteur = Pick<AppUser, "id" | "organization_id">;

/**
 * Ancien fonctionnement (sans la migration 20261023000002) et repli :
 * fiche Tournée colis d'un chauffeur pour un jour, une seule fiche ouverte
 * par chauffeur et par jour, qui regroupe toutes ses tournées planifiées
 * (villages, ramasses, points relais). Reprend la fiche ouverte si elle
 * existe ; après une fiche clôturée, crée une « Tournée supplémentaire »
 * avec les seules tournées affectées depuis.
 *
 * Appelée par le chauffeur (« Nouvelle tournée ») et par l'encadrement à
 * l'affectation d'une tournée (la fiche du chauffeur est alors prête).
 */
async function preparerFicheDuJourReliee(
  supabase: SupabaseClient,
  conducteur: Conducteur,
  jour: string,
  nom: string | null = null,
): Promise<{ run: any; reused: boolean; warning?: string }> {
  let runCreee: Awaited<ReturnType<typeof creerTournee>> | null = null;
  try {
    const dateDuJour = jour;
    const { data: fichesDuJour, error: erreurFiche } = await supabase
      .from("delivery_runs")
      .select(RUN_FIELDS)
      .eq("organization_id", conducteur.organization_id)
      .eq("driver_id", conducteur.id)
      .eq("run_date", dateDuJour)
      .order("created_at", { ascending: false })
      .limit(50);
    if (erreurFiche) throw erreurFiche;

    // Priorité à une fiche ouverte : une ancienne fiche clôturée ne doit pas
    // masquer une fiche active créée ensuite. On conserve toutes les fiches
    // historiques sans supprimer ni écraser leurs données.
    const ficheExistante = (fichesDuJour ?? []).find((fiche: any) =>
      ["loading", "in_progress"].includes(fiche.status)
    ) ?? (fichesDuJour ?? []).find((fiche: any) => fiche.status !== "done");

    // Fiche du jour déjà clôturée : le chauffeur lance une tournée
    // supplémentaire (nouvelle fiche, la clôturée reste intacte dans
    // l'historique). Les tournées planifiées avant elle y ont été chargées :
    // seules celles affectées ensuite viennent sur la nouvelle fiche.
    const supplementaire = !ficheExistante && (fichesDuJour ?? []).some((fiche: any) => fiche.status === "done");

    let run: NonNullable<typeof ficheExistante> | Awaited<ReturnType<typeof creerTournee>> | undefined = ficheExistante;
    if (!run) {
      try {
        run = await creerTournee(supabase, conducteur, nom ?? (supplementaire ? "Tournée supplémentaire" : null), dateDuJour);
      } catch (e) {
        // Double clic : l'index unique « une fiche ouverte par chauffeur et
        // par jour » (migration 20261019000006, audit M3) refuse la seconde ;
        // on reprend la fiche créée par la première requête.
        const doublon = (e as { code?: string })?.code === "23505" || /duplicate key|delivery_runs_driver_open_day_uidx/i.test(e instanceof Error ? e.message : "");
        if (!doublon) throw e;
        const { data: concurrente, error: erreurConcurrente } = await supabase
          .from("delivery_runs")
          .select(RUN_FIELDS)
          .eq("organization_id", conducteur.organization_id)
          .eq("driver_id", conducteur.id)
          .eq("run_date", dateDuJour)
          .neq("status", "done")
          .limit(1)
          .maybeSingle();
        if (erreurConcurrente || !concurrente) throw e;
        return { run: concurrente, reused: true };
      }
    }
    runCreee = run;
    const affecteesApres = await ficheClotureeDuJour(supabase, conducteur, run);
    // Au clic du chauffeur, charger toutes les tournées qui lui sont planifiées
    // pour cette date dans UNE seule fiche Tournée colis.
    const date = run.run_date;
    const veille = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString();
    const lendemain = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString();
    const { data: planning, error: erreurPlanning } = await supabase
      .from("planning_entries")
      .select("id, tour_number, service_id, start_at, status")
      .eq("organization_id", conducteur.organization_id)
      .eq("driver_id", conducteur.id)
      .in("status", ["planned", "in_progress"])
      .gte("start_at", veille)
      .lt("start_at", lendemain)
      .gt("created_at", affecteesApres ?? "1970-01-01T00:00:00Z")
      .order("start_at");
    if (erreurPlanning) throw erreurPlanning;

    const jourParis = (value: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(value));
    const passages = (planning ?? []).filter((entry: any) =>
      jourParis(entry.start_at) === date && Boolean(entry.tour_number)
    );
    if (passages.length) await chargerPassages(supabase, conducteur, run.id, passages, passages);

    // Une liste par village de la tournée du jour, y compris les villages
    // empruntés par un renfort, rattachée à son village (rangement des
    // adresses par commune ou proximité, lib/colis/villages-serveur.ts).
    try {
      const { villages } = await planningEtVillages(supabase, conducteur.organization_id, conducteur.id, run.run_date, affecteesApres);
      if (villages.length) await assurerListesVillages(supabase, conducteur, run.id, villages);
    } catch (e) {
      console.warn("[colis/tournees] Listes des villages incomplètes", { runId: run.id, error: e instanceof Error ? e.message : e });
    }

    // Retourner la version persistée : le nom et les métadonnées viennent
    // d'être mis à jour pendant la fusion des tournées planifiées.
    const { data: runActualise, error: erreurRunActualise } = await supabase
      .from("delivery_runs")
      .select(RUN_FIELDS)
      .eq("id", run.id)
      .maybeSingle();
    if (erreurRunActualise) throw erreurRunActualise;

    return { run: runActualise ?? run, reused: Boolean(ficheExistante) };
  } catch (e) {
    // La fiche est créée avant l'ajout facultatif des ramasses. Une erreur
    // sur le planning, les migrations ou une ramasse ne doit pas faire croire
    // que la création de la fiche elle-même a échoué (ni provoquer un doublon
    // quand on réessaie) : on renvoie la fiche créée et on journalise.
    if (runCreee) {
      console.error("[colis/fiche-du-jour] Fiche créée, mais ajout des ramasses incomplet", {
        runId: runCreee.id,
        error: e instanceof Error ? e.message : e,
      });
      return {
        run: runCreee,
        reused: false,
        warning: "Tournée créée, mais certaines ramasses n’ont pas pu être ajoutées. Vérifiez les migrations Supabase et le planning.",
      };
    }
    throw e;
  }
}

type Passage = { id?: string; tour_number: string | null; service_id: string | null; start_at: string };

/**
 * Charge des affectations sur une fiche : une liste par village, ramasses et
 * points relais (sans doublon d'arrêt). `portes` = toutes les affectations
 * que porte la fiche (nom, heure prévue et service de la fiche).
 */
export async function chargerPassages(supabase: SupabaseClient, conducteur: Conducteur, runId: string, aCharger: Passage[], portes: Passage[]) {
  const tries = [...portes].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  if (tries.length) {
    // La première affectation fournit l'heure et le service par défaut.
    const premiere = tries[0]!;
    const { error: runUpdateError } = await supabase.from("delivery_runs")
      .update({
        name: nomFiche(tries.map((p) => String(p.tour_number))),
        planned_start: heureParis(premiere.start_at),
        ...(premiere.service_id ? { service_id: premiere.service_id } : {}),
      })
      .eq("id", runId);
    if (runUpdateError) throw runUpdateError;
  }
  if (!aCharger.length) return;
    const pays = await codePays(conducteur.organization_id);
    const { data: listesExistantes, error: erreurListesExistantes } = await supabase
      .from("delivery_lists")
      .select("id, name, position")
      .eq("run_id", runId)
      .order("position");
    if (erreurListesExistantes) throw erreurListesExistantes;
    const listesParVillage = new Map<string, { id: string; position: number }>();
    for (const listeExistante of listesExistantes ?? []) {
      listesParVillage.set(cleAdresse(listeExistante.name), {
        id: listeExistante.id,
        position: listeExistante.position,
      });
    }
    const { data: arretsExistants, error: erreurArretsExistants } = await supabase
      .from("delivery_stops")
      .select("kind, address, position")
      .eq("run_id", runId);
    if (erreurArretsExistants) throw erreurArretsExistants;
    const arretsAjoutes = new Set(
      (arretsExistants ?? []).map((stop: any) => `${stop.kind}:${cleAdresse(stop.address)}`)
    );
    let positionListe = Math.max(-1, ...(listesExistantes ?? []).map((l: any) => l.position ?? -1)) + 1;
    let positionArret = Math.max(-1, ...(arretsExistants ?? []).map((s: any) => s.position ?? -1)) + 1;

    for (const passage of aCharger) {
      let routeQuery = supabase.from("tour_routes")
        .select("id, tour_number, service_id")
        .eq("organization_id", conducteur.organization_id)
        .eq("tour_number", passage.tour_number);
      if (passage.service_id) routeQuery = routeQuery.eq("service_id", passage.service_id);
      const { data: routes, error: erreurRoute } = await routeQuery;
      if (erreurRoute) throw erreurRoute;
      const route = (routes ?? [])[0];

      // Tournée fusionnée (lundi) : seulement les villages et ramasses qui reviennent à ce chauffeur
      // ou qui sont encore « À attribuer » (lib/planning/fusion.ts › visiblesPour).
      const fusion = passage.id ? await fusionDeLEntree(conducteur.organization_id, { id: passage.id, service_id: passage.service_id, tour_number: passage.tour_number, start_at: passage.start_at }) : null;
      const visibles = fusion ? visiblesPour(conducteur.id, fusion.elements, fusion.lignes) : null;
      if (!route && !fusion) {
        console.warn("[colis/tournees] Modèle de tournée introuvable", { tourNumber: passage.tour_number, serviceId: passage.service_id });
        continue;
      }

      let villages: any[] = [];
      if (route) {
        const { data, error: erreurVillages } = await supabase
          .from("tour_route_villages")
          .select("id, name, pickup_addresses, planned_stops, position")
          .eq("route_id", route.id)
          .order("position");
        if (erreurVillages) throw erreurVillages;
        villages = data ?? [];
      }
      if (fusion && visibles?.villageIds.size) {
        const { data, error: erreurOrigine } = await supabase
          .from("tour_route_villages")
          .select("id, name, pickup_addresses, planned_stops, position")
          .in("id", [...visibles.villageIds])
          .order("position");
        if (erreurOrigine) throw erreurOrigine;
        const noms = new Set(villages.map((v: any) => cleCommune(v.name)));
        villages = [...villages, ...(data ?? []).filter((v: any) => !noms.has(cleCommune(v.name)))];
      }

      for (const village of villages) {
        if (fusion && visibles) {
          const element = elementDuVillage(village, fusion.elements.villages);
          if (element && !visibles.villageIds.has(element.cle)) continue;
        }
        const villageKey = cleAdresse(village.name);
        let liste = listesParVillage.get(villageKey);
        if (!liste) {
          const { data: creee, error: erreurListe } = await supabase.from("delivery_lists").insert({
            organization_id: conducteur.organization_id,
            run_id: runId,
            name: village.name.slice(0, 60),
            position: positionListe++,
          }).select("id").single();
          if (erreurListe) throw new Error(`Impossible de créer la liste du village « ${village.name} » : ${erreurListe.message}`);
          liste = { id: creee.id, position: positionListe - 1 };
          listesParVillage.set(villageKey, liste);
        }

        // planned_stops distingue les ramasses et points relais. pickup_addresses
        // est conservé comme compatibilité pour les anciennes fiches de tournée.
        const planned = Array.isArray(village.planned_stops) ? village.planned_stops : [];
        const plannedStops = planned
          .filter((s: any) => s && typeof s.address === "string")
          .map((s: any) => ({
            address: s.address.trim(),
            kind: s.type === "point_relais" ? "point_relais" : "ramasse",
            // Point relais : le nom saisi sur la fiche du village devient le nom du relais.
            relayName: s.type === "point_relais" ? normaliserNomRelais(typeof s.name === "string" ? s.name : null) : null,
          }));
        const pickups = (Array.isArray(village.pickup_addresses) ? village.pickup_addresses : [])
          .filter((a: unknown): a is string => typeof a === "string")
          .map((address: string) => ({ address: address.trim(), kind: "ramasse", relayName: null as string | null }));
        const allStops = [...plannedStops, ...pickups];

        for (const stop of allStops) {
          const address = stop.address;
          if (address.length < 5) continue;
          // Ramasse d'une fusion attribuée à un autre chauffeur : pas sur cette fiche.
          if (stop.kind === "ramasse" && fusion && visibles && fusion.elements.ramasses.some((r) => r.cle === cleRamasse(address)) && !visibles.ramasseCles.has(cleRamasse(address))) continue;
          const stopKey = `${stop.kind}:${cleAdresse(address)}`;
          if (arretsAjoutes.has(stopKey)) continue;
          arretsAjoutes.add(stopKey);
          const geo = await geocodeAddress(address, pays).catch(() => null);
          const { error: erreurArret } = await supabase.from("delivery_stops").insert({
            organization_id: conducteur.organization_id,
            run_id: runId,
            list_id: liste.id,
            position: positionArret++,
            kind: stop.kind,
            ...(stop.relayName ? { relay_name: stop.relayName } : {}),
            address,
            // Les ramasses et points relais comptent comme des arrêts uniquement.
            // Le nombre de colis réels sera renseigné lors du traitement de l'arrêt.
            parcel_count: 0,
            status: "pending",
            lat: geo?.lat ?? null,
            lng: geo?.lng ?? null,
          });
          if (erreurArret) throw new Error(`Impossible d’ajouter l’arrêt « ${address} » : ${erreurArret.message}`);
        }
      }
    }
}

// ---------------------------------------------------------------------------
// Fiches par affectation (migration 20261023000002) : séparées par défaut,
// reliées sur demande de l'encadrement (lib/colis/fiches-affectation.ts).
// ---------------------------------------------------------------------------

type Entree = EntreeDuJour & { service_id: string | null; vehicle_id: string | null };
type Resultat = { run: any; reused: boolean; warning?: string };

const ENTREE_FIELDS = "id, tour_number, service_id, vehicle_id, start_at, status, created_at, delivery_run_id";
const FICHE_FIELDS = "id, name, status, created_at, planning_entry_id, fiche_planifiee";
const AVERTISSEMENT = "Tournée créée, mais certaines ramasses n’ont pas pu être ajoutées. Vérifiez les migrations Supabase et le planning.";

/** Colonnes de la migration 20261023000002 présentes ? Sinon ancien fonctionnement (une fiche reliée par jour). */
export async function fichesParAffectationDisponibles(supabase: SupabaseClient): Promise<boolean> {
  const [a, b] = await Promise.all([
    supabase.from("planning_entries").select("delivery_run_id").limit(1),
    supabase.from("delivery_runs").select("fiche_planifiee").limit(1),
  ]);
  return !a.error && !b.error;
}

/** Affectations et fiches colis du chauffeur ce jour-là. */
async function lireJour(supabase: SupabaseClient, conducteur: Conducteur, date: string): Promise<{ entrees: Entree[]; fiches: FicheDuJour[] }> {
  const veille = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString();
  const lendemain = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString();
  const [{ data: entrees, error: e1 }, { data: fiches, error: e2 }] = await Promise.all([
    supabase
      .from("planning_entries")
      .select(ENTREE_FIELDS)
      .eq("organization_id", conducteur.organization_id)
      .eq("driver_id", conducteur.id)
      .gte("start_at", veille)
      .lt("start_at", lendemain)
      .order("start_at"),
    supabase
      .from("delivery_runs")
      .select(FICHE_FIELDS)
      .eq("organization_id", conducteur.organization_id)
      .eq("driver_id", conducteur.id)
      .eq("run_date", date)
      .order("created_at"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return {
    entrees: entreesDuJour((entrees ?? []) as Entree[], date),
    fiches: ((fiches ?? []) as any[]).map((f) => ({ ...f, fiche_planifiee: Boolean(f.fiche_planifiee) })),
  };
}

async function ficheParId(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("delivery_runs").select(RUN_FIELDS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Relie des affectations à une fiche puis y charge leurs villages, ramasses
 * et points relais. Seules les entrées encore sans fiche sont reliées : une
 * entrée portée par une fiche n'est jamais rechargée ailleurs.
 */
async function chargerSurFiche(supabase: SupabaseClient, conducteur: Conducteur, run: { id: string; run_date: string }, aCharger: Entree[], dejaPortees: Entree[]): Promise<string | undefined> {
  try {
    if (aCharger.length) {
      const { data: reliees, error } = await supabase
        .from("planning_entries")
        .update({ delivery_run_id: run.id })
        .in("id", aCharger.map((e) => e.id))
        .is("delivery_run_id", null)
        .select("id");
      if (error) throw error;
      // Une entrée reliée entre-temps à une autre fiche n'est pas chargée ici.
      const ids = new Set(((reliees ?? []) as { id: string }[]).map((r) => r.id));
      const chargees = aCharger.filter((e) => ids.has(e.id));
      await chargerPassages(supabase, conducteur, run.id, chargees, [...dejaPortees, ...chargees]);
    }
    const { villages } = await planningEtVillages(supabase, conducteur.organization_id, conducteur.id, run.run_date, null, run.id);
    if (villages.length) await assurerListesVillages(supabase, conducteur, run.id, villages);
    return undefined;
  } catch (e) {
    console.error("[colis/fiche-du-jour] Fiche prête, mais chargement incomplet", { runId: run.id, error: e instanceof Error ? e.message : e });
    return AVERTISSEMENT;
  }
}

/**
 * Fiche planifiée créée pour une affectation (« Tournée n°X », heure, service
 * et véhicule de l'affectation). Double clic : l'index unique sur
 * planning_entry_id refuse la seconde, on reprend la première.
 */
async function creerFichePlanifiee(supabase: SupabaseClient, conducteur: Conducteur, origine: Entree, date: string): Promise<{ run: any; reused: boolean }> {
  try {
    const run = await creerTournee(supabase, conducteur, nomFiche([String(origine.tour_number)]), date, {
      planningEntryId: origine.id,
      vehicleId: origine.vehicle_id,
      serviceId: origine.service_id,
    });
    return { run, reused: false };
  } catch (e) {
    if ((e as { code?: string })?.code !== "23505") throw e;
    const { data } = await supabase.from("delivery_runs").select(RUN_FIELDS).eq("planning_entry_id", origine.id).maybeSingle();
    if (!data) throw e;
    return { run: data, reused: true };
  }
}

/** Fiche séparée d'une affectation : elle ne porte que cette tournée. */
async function ficheSeparee(supabase: SupabaseClient, conducteur: Conducteur, entree: Entree, date: string): Promise<Resultat> {
  const { run, reused } = await creerFichePlanifiee(supabase, conducteur, entree, date);
  const warning = await chargerSurFiche(supabase, conducteur, run, entree.delivery_run_id ? [] : [entree], []);
  return { run: (await ficheParId(supabase, run.id).catch(() => null)) ?? run, reused, ...(warning ? { warning } : {}) };
}

/**
 * Fiche reliée (exceptionnel) : l'affectation rejoint la fiche ouverte du
 * chauffeur ce jour-là (lib/colis/fiches-affectation.ts › ficheARelier).
 * Sans fiche ouverte : une fiche pour cette affectation et les autres
 * affectations du jour encore sans fiche.
 */
async function ficheReliee(supabase: SupabaseClient, conducteur: Conducteur, entree: Entree, date: string): Promise<Resultat> {
  const { entrees, fiches } = await lireJour(supabase, conducteur, date);
  const cible = ficheARelier(fiches, entrees, entree.start_at);
  if (!cible) {
    const { run, reused } = await creerFichePlanifiee(supabase, conducteur, entree, date);
    const orphelines = entreesOrphelines(entrees, fiches);
    const aCharger = orphelines.some((e) => e.id === entree.id) ? orphelines : [entree, ...orphelines];
    const warning = await chargerSurFiche(supabase, conducteur, run, aCharger, []);
    return { run: (await ficheParId(supabase, run.id).catch(() => null)) ?? run, reused, ...(warning ? { warning } : {}) };
  }
  const portees = entreesDeLaFiche(cible, entrees).filter((e) => e.id !== entree.id);
  const run = await ficheParId(supabase, cible.id);
  if (!run) throw new Error("Fiche Tournée colis introuvable.");
  const warning = await chargerSurFiche(supabase, conducteur, run, [entree], portees);
  return { run: (await ficheParId(supabase, run.id).catch(() => null)) ?? run, reused: true, ...(warning ? { warning } : {}) };
}

/**
 * Avant d'affecter une tournée : faut-il demander « séparées ou reliées » ?
 * null sans la migration (ancien fonctionnement : toujours reliée, sans question).
 */
export async function choixRegroupement(supabase: SupabaseClient, conducteur: Conducteur, date: string): Promise<ChoixRequis | null> {
  if (!(await fichesParAffectationDisponibles(supabase))) return null;
  const { entrees, fiches } = await lireJour(supabase, conducteur, date);
  return choixRequis(entrees, fiches);
}

/**
 * Fiche colis d'une affectation que l'encadrement vient d'inscrire au
 * planning : séparée (défaut) ou reliée à la fiche ouverte du chauffeur.
 */
export async function ficheDeLAffectation(
  supabase: SupabaseClient,
  conducteur: Conducteur,
  entree: Omit<Entree, "delivery_run_id"> & { delivery_run_id?: string | null },
  date: string,
  regroupement: Regroupement,
): Promise<Resultat> {
  if (!(await fichesParAffectationDisponibles(supabase))) return preparerFicheDuJourReliee(supabase, conducteur, date);
  const e: Entree = { ...entree, delivery_run_id: entree.delivery_run_id ?? null };
  return regroupement === "reliee" ? ficheReliee(supabase, conducteur, e, date) : ficheSeparee(supabase, conducteur, e, date);
}

/**
 * « Nouvelle tournée » du chauffeur :
 * - affectations du jour encore sans fiche : une fiche séparée pour CHACUNE
 *   (renvoie la première, la plus tôt ; les autres apparaissent dans ses
 *   onglets) ;
 * - sinon une fiche ouverte existe : on la reprend (libre en priorité, puis
 *   celle en cours) ;
 * - sinon fiche libre (« Tournée supplémentaire » après une fiche clôturée),
 *   sans planning : le chauffeur choisit une tournée-modèle au lancement.
 * Sans la migration : ancien fonctionnement (une fiche reliée par jour).
 */
export async function preparerFicheDuJour(supabase: SupabaseClient, conducteur: Conducteur, jour: string, nom: string | null = null): Promise<Resultat> {
  if (!(await fichesParAffectationDisponibles(supabase))) return preparerFicheDuJourReliee(supabase, conducteur, jour, nom);
  const { entrees, fiches } = await lireJour(supabase, conducteur, jour);
  const orphelines = entreesOrphelines(entrees, fiches);
  if (orphelines.length) {
    const resultats: Resultat[] = [];
    for (const entree of orphelines) resultats.push(await ficheSeparee(supabase, conducteur, entree, jour));
    const warning = resultats.find((r) => r.warning)?.warning;
    return { run: resultats[0]!.run, reused: resultats.every((r) => r.reused), ...(warning ? { warning } : {}) };
  }
  const ouvertes = fiches.filter((f) => f.status !== "done");
  const reprise = ouvertes.find((f) => !f.fiche_planifiee) ?? ouvertes.find((f) => f.status === "in_progress") ?? ouvertes[0];
  if (reprise) {
    const run = await ficheParId(supabase, reprise.id);
    if (run) return { run, reused: true };
  }
  const supplementaire = fiches.some((f) => f.status === "done");
  try {
    const run = await creerTournee(supabase, conducteur, nom ?? (supplementaire ? "Tournée supplémentaire" : null), jour);
    return { run, reused: false };
  } catch (e) {
    // Double clic : une seule fiche libre ouverte par jour (delivery_runs_driver_open_day_libre_uidx).
    if ((e as { code?: string })?.code !== "23505") throw e;
    const { data } = await supabase
      .from("delivery_runs")
      .select(RUN_FIELDS)
      .eq("organization_id", conducteur.organization_id)
      .eq("driver_id", conducteur.id)
      .eq("run_date", jour)
      .eq("fiche_planifiee", false)
      .neq("status", "done")
      .limit(1)
      .maybeSingle();
    if (!data) throw e;
    return { run: data, reused: true };
  }
}
