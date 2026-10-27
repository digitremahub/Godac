import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { addDays } from "@/lib/planning/dates";
import { jourDe } from "@/lib/planning/semaine";
import { nextDay, parisDay } from "@/lib/utils/paris-time";
import {
  ROLES_DESTINATAIRES_FUSION,
  cleAlerteFusion,
  doublonsFusion,
  marquerFusionnees,
  messageAlerteFusion,
  messageDoublon,
  tourneesVerrouilleesParFusion,
  type DoublonFusion,
  type EntreeVerrou,
  type FusionHote,
  type VerrouFusion,
} from "@/lib/planning/fusion-verrou";

/**
 * Cases verrouillées par une fusion : lectures et alertes (règles dans
 * lib/planning/fusion-verrou.ts). Toutes les lectures sont TOLÉRANTES : sans
 * la migration 20261105000002 (tables de fusion), aucune tournée n'est
 * verrouillée ; une lecture en erreur ne bloque jamais une opération (elle
 * est seulement consignée), comme lib/planning/fusion-serveur.ts.
 */

type Db = SupabaseClient;

const LOT = 150;

const lots = <T>(liste: readonly T[], taille: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) r.push(liste.slice(i, i + taille));
  return r;
};

/** Numéros des tournées d'origine de chaque ligne hôte (les lignes non fusionnées sont absentes). Léger : ni villages ni répartition. */
export async function lireOriginesFusion(db: Db, organizationId: string, entryIds: readonly string[]): Promise<FusionHote[]> {
  const ids = [...new Set(entryIds)];
  if (!ids.length) return [];
  const liens: { planning_entry_id: string; route_id: string }[] = [];
  for (const lot of lots(ids, LOT)) {
    const { data, error } = await db.from("planning_entry_merged_routes").select("planning_entry_id, route_id").eq("organization_id", organizationId).in("planning_entry_id", lot);
    if (error) {
      if (!estSchemaManquant(error)) console.warn("[planning/fusion-verrou] Fusions non lues", error.message);
      return [];
    }
    liens.push(...((data ?? []) as typeof liens));
  }
  if (!liens.length) return [];
  const routeIds = [...new Set(liens.map((l) => l.route_id))];
  const numeros = new Map<string, string>();
  for (const lot of lots(routeIds, LOT)) {
    const { data, error } = await db.from("tour_routes").select("id, tour_number").eq("organization_id", organizationId).in("id", lot);
    if (error) {
      console.warn("[planning/fusion-verrou] Tournées d'origine non lues", error.message);
      return [];
    }
    for (const r of (data ?? []) as { id: string; tour_number: string }[]) numeros.set(r.id, r.tour_number);
  }
  const parLigne = new Map<string, string[]>();
  for (const l of liens) {
    const n = numeros.get(l.route_id);
    if (n) parLigne.set(l.planning_entry_id, [...(parLigne.get(l.planning_entry_id) ?? []), n]);
  }
  return [...parLigne].map(([entryId, tournees]) => ({ entryId, tournees }));
}

/** Cases verrouillées par les fusions portées par ces lignes (les lignes sont les hôtes possibles). */
export async function lireVerrous(db: Db, organizationId: string, entrees: readonly EntreeVerrou[]): Promise<Map<string, VerrouFusion>> {
  const candidates = entrees.filter((e) => e.status !== "cancelled" && e.status !== "presence");
  const fusions = await lireOriginesFusion(db, organizationId, candidates.map((e) => e.id));
  return tourneesVerrouilleesParFusion(candidates, fusions);
}

/**
 * Lignes d'un service (ou de toute l'organisation) sur une période de jours de
 * Paris, avec les cases verrouillées qu'elles déterminent. Marge d'un jour de
 * part et d'autre (instants UTC, regroupés par jour de Paris).
 */
export async function verrousDeLaPeriode(db: Db, organizationId: string, serviceId: string | null, premier: string, dernier: string): Promise<{ entrees: EntreeVerrou[]; verrous: Map<string, VerrouFusion> }> {
  const entrees: EntreeVerrou[] = [];
  for (let page = 0; page < 30; page++) {
    let q = db
      .from("planning_entries")
      .select("id, service_id, tour_number, driver_id, start_at, status")
      .eq("organization_id", organizationId)
      .neq("status", "cancelled")
      .neq("status", "presence")
      .gte("start_at", `${addDays(premier, -1)}T00:00:00Z`)
      .lt("start_at", `${addDays(dernier, 2)}T00:00:00Z`);
    if (serviceId) q = q.eq("service_id", serviceId);
    const { data, error } = await q.order("start_at").order("id").range(page * 1000, page * 1000 + 999);
    if (error) {
      if (!estSchemaManquant(error)) console.warn("[planning/fusion-verrou] Planning non lu", error.message);
      return { entrees: [], verrous: new Map() };
    }
    entrees.push(...((data ?? []) as EntreeVerrou[]));
    if (!data || data.length < 1000) break;
  }
  const dansPeriode = entrees.filter((e) => {
    const j = jourDe(e.start_at);
    return j >= premier && j <= dernier;
  });
  return { entrees: dansPeriode, verrous: await lireVerrous(db, organizationId, dansPeriode) };
}

/**
 * Lignes d'aujourd'hui et de demain marquées `fusionnee` quand elles sont une
 * tournée d'origine d'une fusion : surveillance, « À traiter », clôture de la
 * journée ne les comptent ni « sans chauffeur » ni « non démarrées ». Les
 * lignes hôtes de tous statuts (en cours, terminées) comptent, pas seulement
 * celles que la source lit.
 */
export async function marquerFusionneesAujourdhuiDemain<T extends { service_id: string | null; tour_number: string | number | null; start_at: string }>(db: Db, organizationId: string, lignes: readonly T[], maintenant: Date): Promise<(T & { fusionnee: boolean })[]> {
  const aujourdhui = parisDay(maintenant);
  const { verrous } = await verrousDeLaPeriode(db, organizationId, null, aujourdhui, nextDay(aujourdhui));
  return marquerFusionnees(lignes, verrous);
}

/** Doublons d'une semaine pour un service : tournées d'origine d'une fusion encore affectées (bloque l'envoi automatique du vendredi). */
export async function doublonsDeLaSemaine(db: Db, organizationId: string, serviceId: string, lundi: string): Promise<DoublonFusion[]> {
  const { entrees, verrous } = await verrousDeLaPeriode(db, organizationId, serviceId, lundi, addDays(lundi, 6));
  return doublonsFusion(entrees, verrous);
}

export interface DoublonSignale {
  entry_id: string;
  tour_number: string;
  date: string;
  driver_id: string;
  chauffeur: string | null;
  status: string;
  hote: string;
  message: string;
}

/** Noms des chauffeurs de ces doublons (lecture sous le client donné). */
export async function nommerDoublons(db: Db, organizationId: string, doublons: readonly DoublonFusion[]): Promise<DoublonSignale[]> {
  const ids = [...new Set(doublons.map((d) => d.driverId))];
  const noms = new Map<string, string>();
  if (ids.length) {
    const { data } = await db.from("users").select("id, full_name").eq("organization_id", organizationId).in("id", ids);
    for (const u of (data ?? []) as { id: string; full_name: string | null }[]) if (u.full_name) noms.set(u.id, u.full_name);
  }
  return doublons.map((d) => ({
    entry_id: d.entryId,
    tour_number: d.tourNumber,
    date: d.date,
    driver_id: d.driverId,
    chauffeur: noms.get(d.driverId) ?? null,
    status: d.status,
    hote: d.verrou.hoteNumero,
    message: messageDoublon({ tourNumber: d.tourNumber, nom: noms.get(d.driverId), hoteNumero: d.verrou.hoteNumero }),
  }));
}

/**
 * Doublons créés par une fusion qu'on vient de marquer : affectations déjà
 * posées sur ses tournées d'origine le même jour, dans le même service.
 */
export async function doublonsDeLaFusion(db: Db, organizationId: string, hote: { id: string; service_id: string; tour_number: string; start_at: string; status: string }, origines: readonly string[]): Promise<DoublonSignale[]> {
  if (!origines.length) return [];
  const jour = jourDe(hote.start_at);
  const { entrees } = await verrousDeLaPeriode(db, organizationId, hote.service_id, jour, jour);
  const verrous = tourneesVerrouilleesParFusion([{ ...hote }], [{ entryId: hote.id, tournees: origines }]);
  return nommerDoublons(db, organizationId, doublonsFusion(entrees, verrous));
}

// ---------------------------------------------------------------------------
// Alertes d'encadrement : « Tournée n°105 fusionnée avec la n°106 le lundi 9 novembre ».
// ---------------------------------------------------------------------------

export interface BilanAlerteFusion {
  /** Alerte créée (ou rouverte) pour cette fusion. */
  creee: boolean;
  /** Alertes d'une ancienne version de la fusion (ou retirée) closes. */
  closes: number;
  /** Type d'alerte absent (migration 20261111000005 pas appliquée) : aucune alerte. */
  typeAbsent: boolean;
}

/**
 * Clôt les alertes ouvertes « fusionnée avec… » d'une ligne hôte, sauf celle de
 * la clé donnée (fusion actuelle). Sans clé : toutes (fusion retirée ou ligne supprimée).
 */
export async function cloreAlertesFusion(admin: Db, organizationId: string, hoteId: string, cleAGarder: string | null = null): Promise<{ closes: number; typeAbsent: boolean }> {
  const { data, error } = await admin
    .from("alerts")
    .select("id, cle_dedoublonnage")
    .eq("organization_id", organizationId)
    .eq("type", "planning_fusion")
    .eq("related_id", hoteId)
    .in("status", ["open", "acknowledged"])
    .limit(100);
  if (error) {
    if (estValeurEnumInconnue(error)) return { closes: 0, typeAbsent: true };
    if (!estSchemaManquant(error)) console.warn("[planning/fusion] Alertes de fusion non lues", error.message);
    return { closes: 0, typeAbsent: false };
  }
  const aClore = ((data ?? []) as { id: string; cle_dedoublonnage: string | null }[]).filter((a) => a.cle_dedoublonnage !== cleAGarder || cleAGarder === null).map((a) => a.id);
  if (!aClore.length) return { closes: 0, typeAbsent: false };
  const { error: e } = await admin.from("alerts").update({ status: "resolved", acknowledged_at: new Date().toISOString() }).eq("organization_id", organizationId).in("id", aClore);
  if (e) {
    console.warn("[planning/fusion] Alertes de fusion non closes", e.message);
    return { closes: 0, typeAbsent: false };
  }
  return { closes: aClore.length, typeAbsent: false };
}

/**
 * Aligne les alertes sur la fusion d'une ligne hôte : une alerte par fusion et par
 * jour (clé de dédoublonnage), cloche + push + e-mail par le webhook des alertes
 * pour la direction, l'exploitation et les managers du service (jamais les
 * chauffeurs ni le comptable). Fusion modifiée : l'ancienne alerte est close et
 * une nouvelle est créée. Fusion retirée (`origines` vide) : alertes closes.
 * Jamais bloquant ; sans le type d'alerte, rien n'est créé.
 */
export async function synchroniserAlertesFusion(admin: Db, p: { organizationId: string; hote: { id: string; service_id: string; tour_number: string; start_at: string }; origines: readonly string[] }): Promise<BilanAlerteFusion> {
  const bilan: BilanAlerteFusion = { creee: false, closes: 0, typeAbsent: false };
  const origines = [...new Set(p.origines.map((o) => String(o).trim()).filter((o) => o && o !== String(p.hote.tour_number).trim()))];
  const cle = origines.length ? cleAlerteFusion(p.hote.id, origines) : null;
  try {
    // 1. Alertes ouvertes de cette ligne qui ne correspondent plus à la fusion actuelle : closes.
    const clos = await cloreAlertesFusion(admin, p.organizationId, p.hote.id, cle);
    if (clos.typeAbsent) return { ...bilan, typeAbsent: true };
    bilan.closes = clos.closes;
    if (!cle) return bilan;

    // 2. Une alerte par fusion et par jour (index unique organisation + clé).
    const ligne = {
      organization_id: p.organizationId,
      type: "planning_fusion",
      severity: "info",
      message: messageAlerteFusion({ origines, hoteNumero: String(p.hote.tour_number), date: jourDe(p.hote.start_at) }),
      related_table: "planning_entries",
      related_id: p.hote.id,
      recipient_roles: [...ROLES_DESTINATAIRES_FUSION],
      service_id: p.hote.service_id,
    };
    let { error: erreurInsertion } = await admin.from("alerts").insert({ ...ligne, cle_dedoublonnage: cle });
    // Colonne de dédoublonnage absente (migration 20261108000002) : création sans clé.
    if (erreurInsertion && estSchemaManquant(erreurInsertion)) ({ error: erreurInsertion } = await admin.from("alerts").insert(ligne));
    if (!erreurInsertion) return { ...bilan, creee: true };
    if (erreurInsertion.code === "23505") {
      // Même fusion déjà notifiée (retirée puis remise à l'identique) : l'alerte close est rouverte, sans nouveau push.
      const { data: rouvertes } = await admin.from("alerts").update({ status: "open", acknowledged_at: null }).eq("organization_id", p.organizationId).eq("cle_dedoublonnage", cle).eq("status", "resolved").select("id");
      return { ...bilan, creee: (rouvertes ?? []).length > 0 };
    }
    if (estValeurEnumInconnue(erreurInsertion)) return { ...bilan, typeAbsent: true };
    console.warn("[planning/fusion] Alerte de fusion non créée", erreurInsertion.message);
  } catch (e) {
    console.warn("[planning/fusion] Alerte de fusion non créée", e instanceof Error ? e.message : e);
  }
  return bilan;
}
