import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { canManagePendingDriver } from "@/lib/auth/driver-signup-scope";
import { addDays, parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { rapprocherAmende, type CandidatAmende, type Confiance, type CreneauPlanning, type PointGps, type PriseVehicule, type TourneeColis } from "@/lib/rattachement/amende";
import { evaluerPreuve, rapprocherContestation, type ArretCandidat, type CriteresContestation, type PreuveLivraison } from "@/lib/rattachement/contestation";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { destinatairesDe } from "@/lib/hierarchie/serveur";

/**
 * Accès aux données du rapprochement (planning, changements de véhicule,
 * tournées colis, tracé GPS, preuves de livraison). Lectures avec le
 * client de l'utilisateur : la RLS reste l'autorité. Chaque source
 * absente (migration non appliquée) est simplement ignorée.
 */

type Db = SupabaseClient;

async function nomsUtilisateurs(supabase: Db, ids: string[]): Promise<Map<string, string>> {
  const uniques = [...new Set(ids.filter(Boolean))];
  if (uniques.length === 0) return new Map();
  const { data } = await supabase.from("users").select("id, full_name").in("id", uniques);
  return new Map((data ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name]));
}

/** Bornes UTC d'une journée de Paris. */
function journeeParis(jour: string): { debut: string; fin: string } {
  return { debut: parisWallTimeToUtcISOString(jour, "00:00"), fin: parisWallTimeToUtcISOString(addDays(jour, 1), "00:00") };
}

export interface DetailsAmende {
  raison: string;
  immatriculation: string | null;
  candidats: CandidatAmende[];
  calculeLe: string;
}

export interface RechercheAmende {
  confiance: Confiance;
  suggestion: CandidatAmende | null;
  details: DetailsAmende;
}

export async function rechercherResponsableAmende(supabase: Db, organizationId: string, p: { vehicleId: string; infractionAt: string }): Promise<RechercheAmende> {
  const jour = parisCalendarDate(p.infractionAt);
  const { fin } = journeeParis(jour);
  // La veille aussi : une tournée de nuit démarrée la veille peut couvrir l'heure.
  const debutLarge = journeeParis(addDays(jour, -1)).debut;

  const [{ data: vehicule }, { data: entrees }, prisesRes, runsRes] = await Promise.all([
    supabase.from("vehicles").select("registration").eq("id", p.vehicleId).maybeSingle(),
    supabase
      .from("planning_entries")
      .select("id, driver_id, tour_number, vehicle_id, start_at, end_at, status")
      .eq("organization_id", organizationId)
      .eq("vehicle_id", p.vehicleId)
      .gte("start_at", debutLarge)
      .lt("start_at", fin)
      .limit(50),
    supabase
      .from("vehicle_change_photos")
      .select("planning_entry_id, vehicle_id, driver_id, stage, created_at")
      .eq("organization_id", organizationId)
      .eq("vehicle_id", p.vehicleId)
      .gte("created_at", debutLarge)
      .lt("created_at", fin)
      .limit(200),
    supabase.from("delivery_runs").select("id, driver_id, vehicle_id, run_date, planning_entry_id").eq("organization_id", organizationId).eq("run_date", jour).limit(200),
  ]);

  // Prises du véhicule (dédoublonnées : première photo par créneau / véhicule / étape).
  const prisesBrutes = prisesRes.error ? [] : ((prisesRes.data ?? []) as { planning_entry_id: string; vehicle_id: string; driver_id: string | null; stage: "depart" | "retour"; created_at: string }[]);
  const prisesMap = new Map<string, PriseVehicule>();
  for (const x of prisesBrutes) {
    const k = `${x.planning_entry_id}|${x.vehicle_id}|${x.stage}`;
    const cur = prisesMap.get(k);
    if (!cur || x.created_at < cur.at) prisesMap.set(k, { planningEntryId: x.planning_entry_id, vehicleId: x.vehicle_id, driverId: x.driver_id, stage: x.stage, at: x.created_at });
  }

  // Créneaux où le véhicule a changé de main : récupérés aussi (leur vehicle_id peut différer).
  const idsConnus = new Set((entrees ?? []).map((e: { id: string }) => e.id));
  const manquants = [...new Set([...prisesMap.values()].map((x) => x.planningEntryId))].filter((id) => !idsConnus.has(id));
  let autres: typeof entrees = [];
  if (manquants.length) {
    const { data } = await supabase.from("planning_entries").select("id, driver_id, tour_number, vehicle_id, start_at, end_at, status").in("id", manquants);
    autres = data ?? [];
  }
  const toutes = [...(entrees ?? []), ...(autres ?? [])] as { id: string; driver_id: string | null; tour_number: string | null; vehicle_id: string | null; start_at: string; end_at: string | null; status: string }[];
  // Prises des autres véhicules sur ces créneaux (pour savoir quel véhicule était tenu à l'heure dite).
  if (toutes.length) {
    const { data, error } = await supabase
      .from("vehicle_change_photos")
      .select("planning_entry_id, vehicle_id, driver_id, stage, created_at")
      .in("planning_entry_id", toutes.map((e) => e.id))
      .limit(300);
    if (!error) {
      for (const x of (data ?? []) as typeof prisesBrutes) {
        const k = `${x.planning_entry_id}|${x.vehicle_id}|${x.stage}`;
        const cur = prisesMap.get(k);
        if (!cur || x.created_at < cur.at) prisesMap.set(k, { planningEntryId: x.planning_entry_id, vehicleId: x.vehicle_id, driverId: x.driver_id, stage: x.stage, at: x.created_at });
      }
    }
  }

  const runs = runsRes.error ? [] : ((runsRes.data ?? []) as { id: string; driver_id: string; vehicle_id: string | null; run_date: string; planning_entry_id: string | null }[]);
  const noms = await nomsUtilisateurs(supabase, [...toutes.map((e) => e.driver_id ?? ""), ...runs.map((r) => r.driver_id)]);

  // Tracé GPS des tournées du jour autour de l'heure de l'infraction (table récente : tolérée absente).
  let points: PointGps[] = [];
  if (runs.length) {
    const t = Date.parse(p.infractionAt);
    const { data, error } = await supabase
      .from("delivery_run_track_points")
      .select("run_id, recorded_at, lat, lng")
      .in("run_id", runs.map((r) => r.id))
      .gte("recorded_at", new Date(t - 15 * 60_000).toISOString())
      .lte("recorded_at", new Date(t + 15 * 60_000).toISOString())
      .limit(500);
    if (!error) points = ((data ?? []) as { run_id: string; recorded_at: string; lat: number; lng: number }[]).map((x) => ({ runId: x.run_id, at: x.recorded_at, lat: Number(x.lat), lng: Number(x.lng) }));
  }

  const creneaux: CreneauPlanning[] = toutes.map((e) => ({
    id: e.id,
    driverId: e.driver_id,
    driverName: (e.driver_id && noms.get(e.driver_id)) || "—",
    tourNumber: e.tour_number,
    vehicleId: e.vehicle_id,
    startAt: e.start_at,
    endAt: e.end_at,
    status: e.status,
  }));
  const tournees: TourneeColis[] = runs.map((r) => ({ runId: r.id, driverId: r.driver_id, driverName: noms.get(r.driver_id) ?? "—", vehicleId: r.vehicle_id, runDate: r.run_date, planningEntryId: r.planning_entry_id }));

  const r = rapprocherAmende({ vehicleId: p.vehicleId, infractionAt: p.infractionAt, creneaux, prises: [...prisesMap.values()], tournees, points });
  return {
    confiance: r.confiance,
    suggestion: r.suggestion,
    details: { raison: r.raison, immatriculation: (vehicule as { registration?: string } | null)?.registration ?? null, candidats: r.candidats, calculeLe: new Date().toISOString() },
  };
}

// ── Contestations ─────────────────────────────────────────────────

export interface SuggestionContestation {
  driverId: string;
  driverName: string;
  stopId: string | null;
  runId: string | null;
  planningEntryId: string | null;
  raison: string;
}

export interface DetailsContestation {
  raison: string;
  candidats: { stopId: string; driverId: string; driverName: string; runId: string; confiance: string; raison: string; parcelCode: string | null; address: string; doneAt: string | null }[];
  preuve: PreuveLivraison | null;
  tourNumber: string | null;
  calculeLe: string;
}

export interface RechercheContestation {
  confiance: Confiance;
  suggestion: SuggestionContestation | null;
  details: DetailsContestation;
}

const COLONNES_ARRET = "id, parcel_code, address, recipient, status, done_at, delivered_place, proof_photo_path, proof_code, relay_name, lat, lng, run_id, delivery_runs!inner(id, driver_id, run_date, planning_entry_id)";

async function chargerArrets(supabase: Db, organizationId: string, c: CriteresContestation): Promise<ArretCandidat[]> {
  const lancer = (colonnes: string) => {
    const out: PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>[] = [];
    const code = (c.parcelCode ?? "").replace(/[^A-Za-z0-9]/g, "");
    if (code.length >= 4) {
      out.push(supabase.from("delivery_stops").select(colonnes).eq("organization_id", organizationId).ilike("parcel_code", `%${code}%`).limit(20) as never);
    }
    if (c.deliveryDate) {
      out.push(supabase.from("delivery_stops").select(colonnes).eq("organization_id", organizationId).eq("delivery_runs.run_date", c.deliveryDate).limit(800) as never);
    }
    return out;
  };
  let res = await Promise.all(lancer(`${COLONNES_ARRET}, proof_photo_paths`));
  if (res.some((r) => estSchemaManquant(r.error))) res = await Promise.all(lancer(COLONNES_ARRET));

  const vus = new Map<string, Record<string, unknown>>();
  for (const r of res) for (const row of (r.data ?? []) as Record<string, unknown>[]) vus.set(row.id as string, row);
  const lignes = [...vus.values()];
  const noms = await nomsUtilisateurs(supabase, lignes.map((l) => (l.delivery_runs as { driver_id: string }).driver_id));
  const idsPlanning = [...new Set(lignes.map((l) => (l.delivery_runs as { planning_entry_id: string | null }).planning_entry_id).filter(Boolean))] as string[];
  const tournees = new Map<string, string | null>();
  if (idsPlanning.length) {
    const { data } = await supabase.from("planning_entries").select("id, tour_number").in("id", idsPlanning);
    for (const e of (data ?? []) as { id: string; tour_number: string | null }[]) tournees.set(e.id, e.tour_number);
  }
  return lignes.map((l) => {
    const run = l.delivery_runs as { id: string; driver_id: string; run_date: string; planning_entry_id: string | null };
    const multiples = Array.isArray(l.proof_photo_paths) ? (l.proof_photo_paths as string[]).filter(Boolean) : [];
    return {
      id: l.id as string,
      parcelCode: (l.parcel_code as string | null) ?? null,
      address: (l.address as string) ?? "",
      recipient: (l.recipient as string | null) ?? null,
      status: l.status as string,
      doneAt: (l.done_at as string | null) ?? null,
      deliveredPlace: (l.delivered_place as string | null) ?? null,
      proofPhotoPaths: multiples.length ? multiples : l.proof_photo_path ? [l.proof_photo_path as string] : [],
      proofCode: (l.proof_code as string | null) ?? null,
      relayName: (l.relay_name as string | null) ?? null,
      lat: l.lat === null || l.lat === undefined ? null : Number(l.lat),
      lng: l.lng === null || l.lng === undefined ? null : Number(l.lng),
      run: { id: run.id, driverId: run.driver_id, driverName: noms.get(run.driver_id) ?? "—", runDate: run.run_date, planningEntryId: run.planning_entry_id, tourNumber: run.planning_entry_id ? (tournees.get(run.planning_entry_id) ?? null) : null },
    };
  });
}

/** Preuves d'un arrêt : historique et position GPS à la clôture. */
export async function chargerPreuve(supabase: Db, arret: ArretCandidat): Promise<PreuveLivraison> {
  const [evRes, ptRes] = await Promise.all([
    supabase.from("delivery_stop_events").select("event_type, created_at, details").eq("stop_id", arret.id).order("created_at").limit(50),
    arret.doneAt
      ? supabase
          .from("delivery_run_track_points")
          .select("recorded_at, lat, lng")
          .eq("run_id", arret.run.id)
          .gte("recorded_at", new Date(Date.parse(arret.doneAt) - 5 * 60_000).toISOString())
          .lte("recorded_at", new Date(Date.parse(arret.doneAt) + 5 * 60_000).toISOString())
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const evenements = evRes.error ? [] : ((evRes.data ?? []) as { event_type: string; created_at: string; details: string | null }[]).map((e) => ({ type: e.event_type, at: e.created_at, details: e.details }));
  const points = ptRes.error ? [] : ((ptRes.data ?? []) as { recorded_at: string; lat: number; lng: number }[]).map((x) => ({ at: x.recorded_at, lat: Number(x.lat), lng: Number(x.lng) }));
  return evaluerPreuve(arret, evenements, points);
}

export async function rechercherResponsableContestation(supabase: Db, organizationId: string, c: CriteresContestation): Promise<RechercheContestation> {
  const arrets = await chargerArrets(supabase, organizationId, c);
  const r = rapprocherContestation(c, arrets);
  const candidats = r.candidats.slice(0, 10).map((n) => ({
    stopId: n.arret.id,
    driverId: n.arret.run.driverId,
    driverName: n.arret.run.driverName,
    runId: n.arret.run.id,
    confiance: n.confiance,
    raison: n.raison,
    parcelCode: n.arret.parcelCode,
    address: n.arret.address,
    doneAt: n.arret.doneAt,
  }));
  const calculeLe = new Date().toISOString();

  if (r.arret) {
    const preuve = await chargerPreuve(supabase, r.arret);
    return {
      confiance: r.confiance,
      suggestion: { driverId: r.arret.run.driverId, driverName: r.arret.run.driverName, stopId: r.arret.id, runId: r.arret.run.id, planningEntryId: r.arret.run.planningEntryId, raison: `Chauffeur de la tournée : ${r.raison}` },
      details: { raison: r.raison, candidats, preuve, tourNumber: r.arret.run.tourNumber, calculeLe },
    };
  }
  if (candidats.length) return { confiance: r.confiance, suggestion: null, details: { raison: r.raison, candidats, preuve: null, tourNumber: null, calculeLe } };

  // Aucun arrêt : tournée du planning ce jour-là (n° de tournée si connu), seulement si un seul chauffeur.
  if (c.deliveryDate) {
    const { debut, fin } = journeeParis(c.deliveryDate);
    let q = supabase
      .from("planning_entries")
      .select("id, driver_id, tour_number")
      .eq("organization_id", organizationId)
      .in("status", ["in_progress", "done"])
      .not("driver_id", "is", null)
      .gte("start_at", debut)
      .lt("start_at", fin);
    if (c.tourNumber) q = q.eq("tour_number", c.tourNumber.trim());
    const { data } = await q.limit(50);
    const lignes = (data ?? []) as { id: string; driver_id: string; tour_number: string | null }[];
    const uniques = new Set(lignes.map((d) => d.driver_id));
    if (lignes.length && uniques.size === 1 && (c.tourNumber || lignes.length === 1)) {
      const e = lignes[0]!;
      const noms = await nomsUtilisateurs(supabase, [e.driver_id]);
      const raison = c.tourNumber ? `tournée ${c.tourNumber} effectuée ce jour-là` : "seul chauffeur en tournée ce jour-là";
      return {
        confiance: "probable",
        suggestion: { driverId: e.driver_id, driverName: noms.get(e.driver_id) ?? "—", stopId: null, runId: null, planningEntryId: e.id, raison: `Planning : ${raison}` },
        details: { raison, candidats: [], preuve: null, tourNumber: e.tour_number, calculeLe },
      };
    }
  }
  return { confiance: "aucun", suggestion: null, details: { raison: r.raison, candidats: [], preuve: null, tourNumber: null, calculeLe } };
}

// ── Droits et notifications ───────────────────────────────────────

/** Valider un responsable : direction partout ; manager sur les chauffeurs de ses services. */
export async function peutDesignerChauffeur(supabase: Db, appUser: AppUser, driverId: string): Promise<boolean> {
  return canManagePendingDriver(supabase, appUser, driverId);
}

/** Service principal d'un chauffeur (pour cibler l'alerte à l'encadrement concerné). */
export async function serviceDuChauffeur(supabase: Db, driverId: string): Promise<string | null> {
  const { data } = await supabase.from("user_services").select("service_id").eq("user_id", driverId).limit(1).maybeSingle();
  return (data as { service_id?: string } | null)?.service_id ?? null;
}

/**
 * Alerte (relayée en push / e-mail par le webhook des alertes). Insertion
 * par le client service : la RLS d'alerts n'autorise pas l'insertion par
 * un utilisateur (même convention que les amendes et contestations).
 *
 * Routage hiérarchique : avec `demandeurId` (et sans destinataire
 * personnel), l'alerte monte d'un niveau au-dessus de cette personne
 * (manager du service pour un chauffeur ; exploitation et direction pour
 * un manager ; direction pour une exploitation ; les autres membres de la
 * direction pour la direction), avec escalade si ce niveau est vide
 * (lib/hierarchie/demandes.ts › destinatairesNotification) : une alerte
 * personnelle par destinataire, jamais pour lui-même ni pour un pair.
 * Personne au-dessus (direction seule) : aucune alerte. Sans `demandeurId`,
 * diffusion par rôles comme avant.
 */
export async function notifier(
  admin: Db,
  a: { organizationId: string; type: "fine_notification" | "customer_dispute"; severity: "info" | "warning"; message: string; relatedTable: "fines" | "customer_disputes"; relatedId: string; recipientUserId?: string | null; recipientRoles?: string[]; serviceId?: string | null; demandeurId?: string | null },
): Promise<string | null> {
  const base = {
    organization_id: a.organizationId,
    type: a.type,
    severity: a.severity,
    message: a.message,
    related_table: a.relatedTable,
    related_id: a.relatedId,
  };
  let lignes: Record<string, unknown>[];
  if (a.recipientUserId) lignes = [{ ...base, recipient_user_id: a.recipientUserId, ...(a.serviceId ? { service_id: a.serviceId } : {}) }];
  else if (a.demandeurId) {
    const destinataires = await destinatairesDe(admin, a.organizationId, a.demandeurId);
    lignes = destinataires.map((u) => ({ ...base, recipient_user_id: u.id }));
  } else lignes = [{ ...base, recipient_roles: a.recipientRoles ?? ["manager", "exploitation", "direction"], ...(a.serviceId ? { service_id: a.serviceId } : {}) }];
  if (lignes.length === 0) return null;
  const { error } = await admin.from("alerts").insert(lignes);
  return error?.message ?? null;
}
