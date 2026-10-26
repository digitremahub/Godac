import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { cleCommune } from "@/lib/colis/villages";
import { jourDe } from "@/lib/planning/semaine";
import {
  elementsDeFusion,
  type Attribution,
  type ElementFusion,
  type LigneRepartition,
  type ReelChauffeur,
  type RouteOrigine,
  type VillageOrigine,
  appliquerAttributions,
  cleRamasse,
} from "@/lib/planning/fusion";

/**
 * Tournées fusionnées du lundi : accès aux données (règles dans
 * lib/planning/fusion.ts). Toutes les lectures sont tolérantes : sans la
 * migration 20261105000001, aucune tournée n'est fusionnée.
 */

type Db = SupabaseClient;

export interface FusionChargee {
  /** Ligne de planning qui porte la fusion. */
  entryId: string;
  routes: RouteOrigine[];
  elements: { villages: ElementFusion[]; ramasses: ElementFusion[] };
  lignes: LigneRepartition[];
}

const CHAMPS_VILLAGE = "id, name, route_id, position, postal_code, planned_stops, pickup_addresses";

/** Tournées d'origine, éléments et répartition de ces lignes de planning (celles qui ne sont pas fusionnées sont absentes). */
export async function lireFusions(db: Db, organizationId: string, entryIds: readonly string[]): Promise<Map<string, FusionChargee>> {
  const out = new Map<string, FusionChargee>();
  if (!entryIds.length) return out;
  const { data: liens, error } = await db.from("planning_entry_merged_routes").select("planning_entry_id, route_id").eq("organization_id", organizationId).in("planning_entry_id", entryIds.slice(0, 500));
  if (error) {
    if (!estSchemaManquant(error)) console.warn("[planning/fusion] Fusions non lues", error.message);
    return out;
  }
  const lies = (liens ?? []) as { planning_entry_id: string; route_id: string }[];
  if (!lies.length) return out;
  const idsRoutes = [...new Set(lies.map((l) => l.route_id))];
  const idsEntrees = [...new Set(lies.map((l) => l.planning_entry_id))];
  const [{ data: routes }, { data: villages }, { data: lignes }] = await Promise.all([
    db.from("tour_routes").select("id, tour_number").eq("organization_id", organizationId).in("id", idsRoutes),
    db.from("tour_route_villages").select(CHAMPS_VILLAGE).eq("organization_id", organizationId).in("route_id", idsRoutes),
    db.from("planning_entry_repartition").select("planning_entry_id, kind, element_key, element_label, driver_id, route_id, statut").eq("organization_id", organizationId).in("planning_entry_id", idsEntrees),
  ]);
  const routesParId = new Map(((routes ?? []) as RouteOrigine[]).map((r) => [r.id, r]));
  for (const entryId of idsEntrees) {
    const origine = lies.filter((l) => l.planning_entry_id === entryId).map((l) => routesParId.get(l.route_id)).filter((r): r is RouteOrigine => Boolean(r));
    const idsOrigine = new Set(origine.map((r) => r.id));
    const villagesOrigine = ((villages ?? []) as VillageOrigine[]).filter((v) => idsOrigine.has(v.route_id));
    out.set(entryId, {
      entryId,
      routes: origine,
      elements: elementsDeFusion(villagesOrigine, origine),
      lignes: ((lignes ?? []) as (LigneRepartition & { planning_entry_id: string })[]).filter((l) => l.planning_entry_id === entryId),
    });
  }
  return out;
}

/**
 * Fusion qui s'applique à une affectation : la sienne, ou celle d'une
 * affectation sœur (même service, même numéro de tournée, même jour de Paris :
 * plusieurs chauffeurs peuvent porter la même tournée fusionnée, la fusion se
 * marque sur une seule ligne). Lecture admin bornée à l'organisation : le
 * chauffeur ne voit pas la ligne de son collègue, mais sa fiche doit refléter
 * la répartition.
 */
export async function fusionDeLEntree(organizationId: string, entree: { id: string; service_id: string | null; tour_number: string | null; start_at: string }): Promise<FusionChargee | null> {
  try {
    const admin = createAdminSupabaseClient();
    let ids = [entree.id];
    if (entree.tour_number && entree.service_id) {
      const jour = jourDe(entree.start_at);
      const veille = new Date(Date.parse(`${jour}T12:00:00Z`) - 86_400_000).toISOString();
      const lendemain = new Date(Date.parse(`${jour}T12:00:00Z`) + 86_400_000).toISOString();
      const { data } = await admin
        .from("planning_entries")
        .select("id, start_at")
        .eq("organization_id", organizationId)
        .eq("service_id", entree.service_id)
        .eq("tour_number", entree.tour_number)
        .neq("status", "cancelled")
        .gte("start_at", veille)
        .lt("start_at", lendemain);
      ids = [...new Set([entree.id, ...((data ?? []) as { id: string; start_at: string }[]).filter((e) => jourDe(e.start_at) === jour).map((e) => e.id)])];
    }
    const fusions = await lireFusions(admin, organizationId, ids);
    return fusions.get(entree.id) ?? [...fusions.values()][0] ?? null;
  } catch (e) {
    console.warn("[planning/fusion] Fusion de l'affectation non lue", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Chauffeurs de toutes les affectations sœurs d'une fusion ce jour-là (pour choisir une cible et lire le réel). */
export async function chauffeursDeLaFusion(db: Db, organizationId: string, entree: { id: string; service_id: string; tour_number: string; start_at: string }): Promise<string[]> {
  const jour = jourDe(entree.start_at);
  const veille = new Date(Date.parse(`${jour}T12:00:00Z`) - 86_400_000).toISOString();
  const lendemain = new Date(Date.parse(`${jour}T12:00:00Z`) + 86_400_000).toISOString();
  const { data } = await db
    .from("planning_entries")
    .select("driver_id, start_at")
    .eq("organization_id", organizationId)
    .eq("service_id", entree.service_id)
    .eq("tour_number", entree.tour_number)
    .neq("status", "cancelled")
    .not("driver_id", "is", null)
    .gte("start_at", veille)
    .lt("start_at", lendemain);
  return [...new Set(((data ?? []) as { driver_id: string; start_at: string }[]).filter((e) => jourDe(e.start_at) === jour).map((e) => e.driver_id))];
}

/** Marque (ou démarque, `routeIds` vide) une ligne de planning comme fusionnée : remplace la liste des tournées d'origine. */
export async function definirFusion(db: Db, organizationId: string, userId: string, entryId: string, routeIds: readonly string[]): Promise<{ erreur: string | null; manquante: boolean }> {
  const ids = [...new Set(routeIds)];
  const retrait = await db.from("planning_entry_merged_routes").delete().eq("planning_entry_id", entryId).eq("organization_id", organizationId);
  if (retrait.error) return { erreur: retrait.error.message, manquante: estSchemaManquant(retrait.error) };
  if (!ids.length) {
    // Plus de fusion : la répartition provisoire n'a plus d'objet.
    await db.from("planning_entry_repartition").delete().eq("planning_entry_id", entryId).eq("organization_id", organizationId);
    return { erreur: null, manquante: false };
  }
  const { error } = await db.from("planning_entry_merged_routes").insert(ids.map((route_id) => ({ organization_id: organizationId, planning_entry_id: entryId, route_id, created_by: userId })));
  if (error) return { erreur: error.message, manquante: estSchemaManquant(error) };
  return { erreur: null, manquante: false };
}

/**
 * Enregistre des attributions (lib/planning/fusion.ts › appliquerAttributions)
 * et renvoie les éléments dont la cible a changé.
 */
export async function ecrireRepartition(
  db: Db,
  organizationId: string,
  userId: string,
  fusion: FusionChargee,
  attributions: readonly Attribution[],
): Promise<{ erreur: string | null; modifies: number; lignes: LigneRepartition[] }> {
  const tous = [...fusion.elements.villages, ...fusion.elements.ramasses];
  const { ecrire, supprimer } = appliquerAttributions(tous, fusion.lignes, attributions);
  if (supprimer.length) {
    for (const s of supprimer) {
      const { error } = await db.from("planning_entry_repartition").delete().eq("organization_id", organizationId).eq("planning_entry_id", fusion.entryId).eq("kind", s.kind).eq("element_key", s.element_key);
      if (error) return { erreur: error.message, modifies: 0, lignes: fusion.lignes };
    }
  }
  if (ecrire.length) {
    const maintenant = new Date().toISOString();
    const { error } = await db.from("planning_entry_repartition").upsert(
      ecrire.map((l) => ({ ...l, organization_id: organizationId, planning_entry_id: fusion.entryId, updated_by: userId, updated_at: maintenant })),
      { onConflict: "planning_entry_id,kind,element_key" },
    );
    if (error) return { erreur: error.message, modifies: 0, lignes: fusion.lignes };
  }
  const retirees = new Set(supprimer.map((s) => `${s.kind}:${s.element_key}`));
  const ecrites = new Map(ecrire.map((l) => [`${l.kind}:${l.element_key}`, l]));
  const lignes = [...fusion.lignes.filter((l) => !retirees.has(`${l.kind}:${l.element_key}`) && !ecrites.has(`${l.kind}:${l.element_key}`)), ...ecrire];
  return { erreur: null, modifies: ecrire.length + supprimer.length, lignes };
}

// ---------------------------------------------------------------------------
// Réel : ce que les chauffeurs ont sur leurs fiches Tournée colis du jour.
// ---------------------------------------------------------------------------

/**
 * Villages réellement desservis et ramasses réellement présentes sur les
 * fiches de ces chauffeurs ce jour-là (delivery_runs, delivery_lists,
 * delivery_stops). Un village est desservi s'il a au moins un arrêt de
 * livraison dans sa liste (les listes vides créées au lancement ne comptent
 * pas) ; la liste est reconnue par son village_id, sinon par son nom.
 */
export async function lireReel(db: Db, organizationId: string, date: string, driverIds: readonly string[], elements: { villages: readonly ElementFusion[] }): Promise<ReelChauffeur[]> {
  if (!driverIds.length) return [];
  const { data: runs } = await db.from("delivery_runs").select("id, driver_id").eq("organization_id", organizationId).eq("run_date", date).in("driver_id", [...driverIds]);
  const fiches = (runs ?? []) as { id: string; driver_id: string }[];
  if (!fiches.length) return driverIds.map((driverId) => ({ driverId, villageIds: [], ramasses: [] }));
  const ids = fiches.map((f) => f.id);
  const [listesRes, arretsRes] = await Promise.all([
    db.from("delivery_lists").select("id, run_id, name, village_id").in("run_id", ids),
    db.from("delivery_stops").select("run_id, list_id, kind, address, status").in("run_id", ids),
  ]);
  // Sans la migration 190 (village_id absent) : reconnaissance par le nom de la liste.
  let listes = (listesRes.data ?? []) as { id: string; run_id: string; name: string; village_id?: string | null }[];
  if (listesRes.error) {
    const { data } = await db.from("delivery_lists").select("id, run_id, name").in("run_id", ids);
    listes = (data ?? []) as typeof listes;
  }
  const arrets = (arretsRes.data ?? []) as { run_id: string; list_id: string | null; kind: string; address: string; status: string }[];
  const parNom = new Map(elements.villages.map((v) => [cleCommune(v.label), v.cle]));
  const elementDe = (l: { name: string; village_id?: string | null }) => (l.village_id && elements.villages.some((v) => v.cle === l.village_id) ? l.village_id : (parNom.get(cleCommune(l.name)) ?? null));

  return driverIds.map((driverId) => {
    const runsDuChauffeur = new Set(fiches.filter((f) => f.driver_id === driverId).map((f) => f.id));
    const villageIds = new Set<string>();
    for (const l of listes.filter((x) => runsDuChauffeur.has(x.run_id))) {
      const element = elementDe(l);
      if (element && arrets.some((a) => a.list_id === l.id && a.kind === "livraison")) villageIds.add(element);
    }
    const ramasses = new Map<string, boolean>();
    for (const a of arrets.filter((x) => runsDuChauffeur.has(x.run_id) && x.kind === "ramasse")) {
      const cle = cleRamasse(a.address);
      ramasses.set(cle, (ramasses.get(cle) ?? false) || a.status === "done");
    }
    return { driverId, villageIds: [...villageIds], ramasses: [...ramasses].map(([cle, faite]) => ({ cle, faite })) };
  });
}
