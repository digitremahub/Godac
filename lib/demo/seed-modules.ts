import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, parisCalendarDate } from "@/lib/planning/dates";
import { cleAdresse } from "@/lib/colis/serveur";
import { contextePaie } from "@/lib/paie/donnees";
import { calculerBulletin } from "@/lib/paie/calcul";
import { fusionnerRetenues } from "@/lib/paie/acomptes";
import { rattacherAcomptes } from "@/lib/paie/acomptes-serveur";
import { genererBulletinPdf } from "@/lib/paie/pdf";
import { donneesBulletinPdf } from "@/lib/paie/rendu-bulletin";
import type { VariablesMois } from "@/lib/paie/types";

/**
 * Démo — les modules récents de GODAC (lib/demo/seed.ts appelle
 * seedModulesRecents après le socle) : Tournée colis (modèles de tournée,
 * villages, ramasses, points relais, fiches du jour, tournée clôturée et
 * son historique), modèles du Planning, Paie transport (réglages, profils,
 * bulletin validé, acomptes) et traitement des écarts carburant.
 *
 * Chaque partie est facultative : une table ou une colonne absente (base
 * pas encore migrée) n'empêche jamais la démo de se construire — la
 * colonne est retirée, la partie est sautée et un avertissement est
 * journalisé. Noms, adresses et téléphones sont fictifs (numéros de la
 * plage 06 39 98 réservée à la fiction par l'ARCEP).
 */

type Ligne = Record<string, unknown>;

export interface ContexteDemo {
  admin: SupabaseClient;
  orgId: string;
  userIds: Record<string, string>;
  services: { id: string; name: string }[];
  vehicleByDriver: Record<string, { id: string; registration: string }>;
  today: string;
  at: (day: string, time: string) => string;
  /** Affectations du planning insérées par le socle. */
  affectations: { id: string; driver_id: string; start_at: string; status: string; tour_number: string }[];
  /** Pleins portant un écart de totaliseur, dans l'ordre chronologique. */
  pleinsAvecEcart: { id: string; driver: string }[];
}

const DEPOT = { label: "Dépôt Lyon Sud — 12 rue du Dépôt, 69007 Lyon", lat: 45.7286, lng: 4.8324 };
const DEPOT_VALENCE = { label: "Dépôt Valence — 4 avenue de Romans, 26000 Valence", lat: 44.9334, lng: 4.8924 };

/** Insertion tolérante : une colonne inconnue du schéma (migration pas encore passée) est retirée, puis on réessaie. */
async function inserer(admin: SupabaseClient, table: string, rows: Ligne | Ligne[], select?: string): Promise<any[]> {
  let lignes = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
  for (let essai = 0; essai < 10; essai++) {
    const requete = admin.from(table).insert(lignes);
    const { data, error } = select ? await requete.select(select) : await requete;
    if (!error) return (data ?? []) as any[];
    const colonne = /'([a-z0-9_]+)' column/.exec(error.message)?.[1];
    if (!colonne || !lignes.some((l) => colonne in l)) throw new Error(`${table} : ${error.message}`);
    lignes = lignes.map(({ [colonne]: _retiree, ...reste }) => reste);
  }
  throw new Error(`${table} : trop de colonnes absentes`);
}

async function facultatif(quoi: string, partie: () => Promise<void>) {
  try {
    await partie();
  } catch (e) {
    console.warn(`Démo — ${quoi} ignoré :`, e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// Tournée colis
// ---------------------------------------------------------------------------

type ArretPrevu = { type: "ramasse" | "point_relais"; name: string; address: string; time_window?: string };
type Village = { name: string; cp: string; lat: number; lng: number; stops: ArretPrevu[] };

/** Modèles de tournée : un par numéro du planning (L100… pour Lyon Sud, V103… pour Valence). */
const ROUTES: { tour: string; service: 0 | 1; driver: string; villages: Village[] }[] = [
  {
    tour: "L100", service: 0, driver: "karim",
    villages: [
      { name: "Saint-Fons", cp: "69190", lat: 45.7086, lng: 4.8533, stops: [{ type: "ramasse", name: "Imprimerie du Rhône", address: "14 rue Carnot, 69190 Saint-Fons", time_window: "14:00-16:00" }] },
      { name: "Vénissieux", cp: "69200", lat: 45.6973, lng: 4.8868, stops: [{ type: "point_relais", name: "Tabac-Presse du Centre", address: "3 avenue Jean Jaurès, 69200 Vénissieux" }] },
      { name: "Feyzin", cp: "69320", lat: 45.6736, lng: 4.858, stops: [] },
    ],
  },
  {
    tour: "L101", service: 0, driver: "lucas",
    villages: [
      { name: "Oullins", cp: "69600", lat: 45.7146, lng: 4.8075, stops: [{ type: "ramasse", name: "Atelier Couture Lumière", address: "8 grande rue, 69600 Oullins" }] },
      { name: "Pierre-Bénite", cp: "69310", lat: 45.7036, lng: 4.8247, stops: [] },
      { name: "Irigny", cp: "69540", lat: 45.6731, lng: 4.8225, stops: [{ type: "point_relais", name: "Épicerie du Bourg", address: "2 place de l'Église, 69540 Irigny" }] },
    ],
  },
  {
    tour: "L102", service: 0, driver: "nadia",
    villages: [
      { name: "Saint-Genis-Laval", cp: "69230", lat: 45.6956, lng: 4.7931, stops: [{ type: "point_relais", name: "Librairie des Collines", address: "21 avenue Clémenceau, 69230 Saint-Genis-Laval" }] },
      { name: "Brignais", cp: "69530", lat: 45.6739, lng: 4.7542, stops: [{ type: "ramasse", name: "Cave des Coteaux", address: "6 rue du Général de Gaulle, 69530 Brignais", time_window: "15:00-17:00" }] },
      { name: "Chaponost", cp: "69630", lat: 45.71, lng: 4.7422, stops: [] },
    ],
  },
  {
    tour: "V103", service: 1, driver: "thomas",
    villages: [
      { name: "Bourg-lès-Valence", cp: "26500", lat: 44.9475, lng: 4.8936, stops: [{ type: "ramasse", name: "Savonnerie Drômoise", address: "10 rue Jean Jaurès, 26500 Bourg-lès-Valence" }] },
      { name: "Guilherand-Granges", cp: "07500", lat: 44.933, lng: 4.8738, stops: [] },
      { name: "Saint-Péray", cp: "07130", lat: 44.9487, lng: 4.8453, stops: [{ type: "point_relais", name: "Presse du Château", address: "5 rue de la République, 07130 Saint-Péray" }] },
    ],
  },
  {
    tour: "V104", service: 1, driver: "mehdi",
    villages: [
      { name: "Portes-lès-Valence", cp: "26800", lat: 44.8756, lng: 4.8764, stops: [{ type: "point_relais", name: "Bureau de tabac de la Gare", address: "1 avenue de la Gare, 26800 Portes-lès-Valence" }] },
      { name: "Étoile-sur-Rhône", cp: "26800", lat: 44.8386, lng: 4.8908, stops: [] },
      { name: "Beaumont-lès-Valence", cp: "26760", lat: 44.8622, lng: 4.9425, stops: [{ type: "ramasse", name: "Ferme des Trois Chênes", address: "18 route de Montéléger, 26760 Beaumont-lès-Valence" }] },
    ],
  },
  {
    tour: "V105", service: 1, driver: "elodie",
    villages: [
      { name: "Chabeuil", cp: "26120", lat: 44.8983, lng: 5.0192, stops: [{ type: "ramasse", name: "Poterie du Vercors", address: "7 rue du Lavoir, 26120 Chabeuil" }] },
      { name: "Montélier", cp: "26120", lat: 44.9347, lng: 5.0311, stops: [] },
      { name: "Malissard", cp: "26120", lat: 44.8992, lng: 4.9531, stops: [{ type: "point_relais", name: "Superette du Village", address: "4 place de la Mairie, 26120 Malissard" }] },
    ],
  },
];

/** Établissements pros de la tournée L100, avec leurs horaires d'ouverture (semaine ISO, "1" = lundi). */
const PROS = [
  {
    label: "Boulangerie des Halles",
    address: "5 place Roger Salengro, 69190 Saint-Fons",
    source: "openstreetmap",
    weekly_schedule: {
      ...Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((j) => [j, [{ open: "06:30", close: "13:00" }, { open: "15:30", close: "19:30" }]])),
      "7": [],
    },
  },
  {
    label: "Pharmacie de la Mairie",
    address: "9 rue de la Mairie, 69320 Feyzin",
    source: "manuel",
    weekly_schedule: {
      ...Object.fromEntries(["1", "2", "3", "4", "5"].map((j) => [j, [{ open: "09:00", close: "12:15" }, { open: "14:30", close: "19:00" }]])),
      "6": [{ open: "09:00", close: "12:00" }],
      "7": [],
    },
  },
  {
    label: "Garage Rhône Auto",
    address: "40 route de Vienne, 69200 Vénissieux",
    source: "openstreetmap",
    weekly_schedule: Object.fromEntries(["1", "2", "3", "4", "5"].map((j) => [j, [{ open: "08:00", close: "12:00" }, { open: "13:30", close: "18:00" }]])),
  },
];

type ArretFiche = Ligne & { village: number };

/** Fiche du jour de Karim (compte « chauffeur » de la démo) : tous les cas d'arrêt. */
function arretsKarim(today: string, at: ContexteDemo["at"]): ArretFiche[] {
  const fait = (heure: string) => at(today, heure);
  return [
    { village: 0, kind: "livraison", address: "22 rue de la République, 69190 Saint-Fons", recipient: "Claire Lambert", phone: "06 39 98 01 01", parcel_code: "GD4500012871FR", weight_kg: 2.4, status: "delivered", delivered_place: "main_propre", done_at: fait("07:18") },
    { village: 0, kind: "livraison", business_name: "Boulangerie des Halles", address: "5 place Roger Salengro, 69190 Saint-Fons", recipient: "Boulangerie des Halles", phone: "06 39 98 01 02", parcel_code: "GD4500012872FR", parcel_count: 2, weight_kg: 8.6, window_start: "06:30", window_end: "13:00", status: "delivered", delivered_place: "main_propre", done_at: fait("07:31"), packages_delivered: 2 },
    { village: 0, kind: "ramasse", address: "14 rue Carnot, 69190 Saint-Fons", recipient: "Imprimerie du Rhône", phone: "06 39 98 01 03", parcel_count: 0, window_start: "14:00", window_end: "16:00", status: "pending" },
    { village: 1, kind: "livraison", address: "40 route de Vienne, 69200 Vénissieux", business_name: "Garage Rhône Auto", recipient: "Garage Rhône Auto", phone: "06 39 98 01 04", parcel_code: "GD4500012873FR", weight_kg: 14.2, window_start: "08:00", window_end: "12:00", status: "delivered", delivered_place: "qr_code", proof_code: "GODAC-QR-48213", done_at: fait("08:02") },
    { village: 1, kind: "livraison", address: "17 rue Paul Bert, 69200 Vénissieux", recipient: "Hugo Morel", phone: "06 39 98 01 05", parcel_code: "GD4500012874FR", weight_kg: 1.1, status: "failed", failure_reason: "absent", notes: "Absent · avis de passage déposé", done_at: fait("08:15") },
    { village: 1, kind: "livraison", address: "9 allée des Tilleuls, 69200 Vénissieux", recipient: "Inès Garnier", phone: null, parcel_code: "GD4500012875FR", weight_kg: 12.5, notes: "Sonnette hors service", status: "pending" },
    { village: 1, kind: "point_relais", relay_name: "Tabac-Presse du Centre", address: "3 avenue Jean Jaurès, 69200 Vénissieux", parcel_count: 4, weight_kg: 6.3, status: "pending" },
    { village: 2, kind: "livraison", business_name: "Pharmacie de la Mairie", address: "9 rue de la Mairie, 69320 Feyzin", recipient: "Pharmacie de la Mairie", phone: "06 39 98 01 06", parcel_code: "GD4500012876FR", weight_kg: 3.8, window_start: "09:00", window_end: "12:15", status: "pending" },
    { village: 2, kind: "livraison", address: "31 chemin des Razes, 69320 Feyzin", recipient: "Paul Renaud", phone: "06 39 98 01 07", parcel_code: "GD4500012877FR", parcel_count: 2, weight_kg: 31, notes: "Colis lourd : prévoir le diable", status: "pending" },
    { village: 2, kind: "ramasse", exceptional_pickup: true, address: "12 rue du Stade, 69320 Feyzin", recipient: "Atelier Vélo Feyzin", phone: "06 39 98 01 08", parcel_count: 0, notes: "Ramasse exceptionnelle demandée ce matin", status: "pending" },
  ];
}

/** Fiche clôturée d'hier (Karim) : livrée, avec un échec, une ramasse et un point relais. */
function arretsHier(): ArretFiche[] {
  return [
    { village: 0, kind: "livraison", address: "4 rue Victor Hugo, 69190 Saint-Fons", recipient: "Julie Faure", phone: "06 39 98 02 01", parcel_code: "GD4500011901FR", weight_kg: 1.8, status: "delivered", delivered_place: "boite_aux_lettres" },
    { village: 0, kind: "ramasse", address: "14 rue Carnot, 69190 Saint-Fons", recipient: "Imprimerie du Rhône", parcel_count: 0, status: "delivered", packages_picked_up: 6 },
    { village: 1, kind: "livraison", address: "40 route de Vienne, 69200 Vénissieux", business_name: "Garage Rhône Auto", recipient: "Garage Rhône Auto", phone: "06 39 98 01 04", parcel_code: "GD4500011902FR", weight_kg: 22.4, window_start: "08:00", window_end: "12:00", status: "delivered", delivered_place: "qr_code", proof_code: "GODAC-QR-47710" },
    { village: 1, kind: "point_relais", relay_name: "Tabac-Presse du Centre", address: "3 avenue Jean Jaurès, 69200 Vénissieux", parcel_count: 5, status: "delivered", delivered_place: "point_relais", packages_delivered: 5 },
    { village: 1, kind: "livraison", address: "26 rue Gambetta, 69200 Vénissieux", recipient: "Marc Blanc", phone: "06 39 98 02 02", parcel_code: "GD4500011903FR", weight_kg: 4.1, status: "failed", failure_reason: "adresse_introuvable", notes: "Adresse introuvable · numéro absent de la rue" },
    { village: 2, kind: "livraison", address: "9 rue de la Mairie, 69320 Feyzin", business_name: "Pharmacie de la Mairie", recipient: "Pharmacie de la Mairie", phone: "06 39 98 01 06", parcel_code: "GD4500011904FR", weight_kg: 2.2, window_start: "09:00", window_end: "12:15", status: "delivered", delivered_place: "main_propre" },
    { village: 2, kind: "livraison", address: "3 impasse des Vignes, 69320 Feyzin", recipient: "Léa Fontaine", phone: "06 39 98 02 03", parcel_code: "GD4500011905FR", weight_kg: 0.9, status: "delivered", delivered_place: "voisin", notes: "Remis au voisin du n° 5" },
  ];
}

/** Fiche simple pour les autres chauffeurs : les arrêts prévus des villages, plus deux livraisons par village. */
function arretsGeneriques(route: (typeof ROUTES)[number], livres: number): ArretFiche[] {
  const arrets: ArretFiche[] = [];
  route.villages.forEach((v, iv) => {
    for (const s of v.stops) {
      arrets.push({ village: iv, kind: s.type, address: s.address, recipient: s.type === "ramasse" ? s.name : null, relay_name: s.type === "point_relais" ? s.name : null, parcel_count: s.type === "point_relais" ? 3 : 0, status: "pending" });
    }
    [0, 1].forEach((k) => {
      arrets.push({
        village: iv,
        kind: "livraison",
        address: `${12 + 7 * k + iv} rue de la Liberté, ${v.cp} ${v.name}`,
        recipient: ["Sarah Dupuis", "Antoine Leroy", "Manon Perrin", "Nicolas Robin", "Camille Mercier", "Yanis Girard"][(iv * 2 + k) % 6],
        phone: k === 1 && iv === 1 ? null : `06 39 98 0${3 + iv} ${String(10 + k).padStart(2, "0")}`,
        parcel_code: `GD45000${route.tour.slice(1)}${iv}${k}FR`,
        weight_kg: Math.round((1.5 + 3.2 * k + iv) * 10) / 10,
        status: "pending",
      });
    });
  });
  // Les premiers arrêts sont déjà livrés.
  return arrets.map((a, i) => (i < livres && a.kind === "livraison" ? { ...a, status: "delivered", delivered_place: "main_propre" } : a));
}

async function seedTourneeColis(c: ContexteDemo) {
  const { admin, orgId, userIds, services, vehicleByDriver, today, at } = c;

  // Modèles de tournée et leurs villages (avec ramasses et points relais prévus).
  const routes = await inserer(
    admin,
    "tour_routes",
    ROUTES.map((r) => ({ organization_id: orgId, service_id: services[r.service]!.id, tour_number: r.tour, notes: `Tournée messagerie ${r.villages.map((v) => v.name).join(", ")}` })),
    "id, tour_number",
  );
  const routeId = (tour: string) => routes.find((r) => r.tour_number === tour)!.id as string;
  const villagesParTour: Record<string, { id: string; name: string }[]> = {};
  for (const r of ROUTES) {
    const lignes = await inserer(
      admin,
      "tour_route_villages",
      r.villages.map((v, i) => ({
        organization_id: orgId,
        route_id: routeId(r.tour),
        position: i,
        name: v.name,
        postal_code: v.cp,
        lat: v.lat,
        lng: v.lng,
        geocode_status: "ok",
        geocoded_at: new Date().toISOString(),
        planned_stops: v.stops.map((s, k) => ({ id: `${r.tour}-${i}-${k}`, ...s })),
      })),
      "id, name, position",
    );
    villagesParTour[r.tour] = lignes.sort((a, b) => a.position - b.position);
  }

  // Annuaire des établissements pros et de leurs horaires (pris en compte par l'optimisation).
  await facultatif("horaires des établissements", async () => {
    await inserer(
      admin,
      "delivery_address_hours",
      PROS.map((p) => ({
        organization_id: orgId,
        address_key: cleAdresse(p.address),
        label: p.label,
        address: p.address,
        weekly_schedule: p.weekly_schedule,
        source: p.source,
        found_at: p.source === "manuel" ? null : at(addDays(today, -12), "10:00"),
        updated_by: userIds.manager,
      })),
    );
  });

  const affectation = (driver: string, day: string) =>
    c.affectations.find((a) => a.driver_id === userIds[driver] && parisCalendarDate(a.start_at) === day);

  async function creerFiche(params: { driver: string; tour: string; day: string; status: "loading" | "in_progress" | "done"; arrets: ArretFiche[]; confirmee: boolean; heureFin?: string }) {
    const route = ROUTES.find((r) => r.tour === params.tour)!;
    const villages = villagesParTour[params.tour]!;
    const depot = route.service === 0 ? DEPOT : DEPOT_VALENCE;
    const entree = affectation(params.driver, params.day);
    const veh = vehicleByDriver[params.driver];
    const [run] = await inserer(
      admin,
      "delivery_runs",
      {
        organization_id: orgId,
        driver_id: userIds[params.driver],
        run_date: params.day,
        name: `Tournée ${params.tour}`,
        status: params.status,
        start_label: depot.label,
        start_lat: depot.lat,
        start_lng: depot.lng,
        return_to_start: true,
        optimized_at: at(params.day, "06:20"),
        vehicle_id: veh?.id ?? null,
        service_id: services[route.service]!.id,
        planned_start: "06:30",
        launch_confirmed_at: params.confirmee ? at(params.day, "06:35") : null,
        launch_village_ids: params.confirmee ? villages.map((v) => v.id) : [],
        route_id: routeId(params.tour),
        planning_entry_id: entree?.id ?? null,
        fiche_planifiee: Boolean(entree),
      },
      "id",
    );
    const runId = run!.id as string;
    if (entree) {
      // Fiche séparée : l'affectation du planning pointe vers sa fiche colis (migration 20261023000002).
      const { error } = await admin.from("planning_entries").update({ delivery_run_id: runId }).eq("id", entree.id);
      if (error) console.warn("Démo — lien affectation → fiche colis ignoré :", error.message);
    }
    // Une liste par village, créée comme le fait l'application au chargement des affectations.
    const listes = await inserer(
      admin,
      "delivery_lists",
      villages.map((v, i) => ({ organization_id: orgId, run_id: runId, name: v.name, position: i, village_id: v.id, is_hors_tournee: false })),
      "id, position",
    );
    const listeDuVillage = (i: number) => listes.find((l) => l.position === i)!.id as string;
    const lignes = params.arrets.map(({ village, ...a }, i) => {
      const v = route.villages[village]!;
      const heure = 7 * 60 + 10 + i * 17;
      const doneAt = a.status === "pending" ? null : (a.done_at as string | undefined) ?? at(params.day, `${String(Math.floor(heure / 60)).padStart(2, "0")}:${String(heure % 60).padStart(2, "0")}`);
      return {
        organization_id: orgId,
        run_id: runId,
        list_id: listeDuVillage(village),
        position: i,
        parcel_count: 1,
        lat: Math.round((v.lat + 0.0021 * ((i % 3) - 1)) * 1e6) / 1e6,
        lng: Math.round((v.lng + 0.0032 * (i % 2 ? 1 : -1)) * 1e6) / 1e6,
        hours_lookup_at: a.business_name ? at(params.day, "06:20") : null,
        ...a,
        done_at: doneAt,
      };
    });
    const arrets = await inserer(admin, "delivery_stops", lignes, "id, status, kind, done_at, position, packages_picked_up, packages_delivered, failure_reason");
    return { runId, arrets: arrets.sort((a, b) => a.position - b.position) };
  }

  // Aujourd'hui : Karim (compte chauffeur de la démo) et Nadia en tournée, Lucas n'a pas encore confirmé la sienne.
  await creerFiche({ driver: "karim", tour: "L100", day: today, status: "in_progress", arrets: arretsKarim(today, at), confirmee: true });
  await creerFiche({ driver: "nadia", tour: "L102", day: today, status: "in_progress", arrets: arretsGeneriques(ROUTES[2]!, 3), confirmee: true });
  await creerFiche({ driver: "lucas", tour: "L101", day: today, status: "loading", arrets: arretsGeneriques(ROUTES[1]!, 0), confirmee: false });

  // Hier (dernier jour ouvré) : tournée de Karim clôturée — verrouillée, avec l'historique de chaque arrêt.
  let hier = addDays(today, -1);
  while ([0, 6].includes(new Date(`${hier}T12:00:00Z`).getUTCDay())) hier = addDays(hier, -1);
  const cloturee = await creerFiche({ driver: "karim", tour: "L100", day: hier, status: "done", arrets: arretsHier(), confirmee: true });

  await facultatif("historique des arrêts", async () => {
    const acteur = userIds.karim!;
    const evenements: Ligne[] = [];
    const ev = (stopId: string, event_type: string, created_at: string, details: string, extra: Ligne = {}) =>
      evenements.push({ organization_id: orgId, run_id: cloturee.runId, stop_id: stopId, actor_id: acteur, event_type, created_at, details, ...extra });
    cloturee.arrets.forEach((s) => {
      ev(s.id, "stop_created", at(hier, "06:12"), s.kind === "livraison" ? "Colis scanné au chargement" : "Arrêt chargé depuis le modèle de tournée");
      const fin = s.done_at as string;
      const avant = new Date(Date.parse(fin) - 60_000).toISOString();
      if (s.failure_reason) {
        ev(s.id, "call_started", avant, "Appel lancé");
        ev(s.id, "failed", fin, "Échec de livraison", { previous_value: { status: "pending" }, new_value: { status: "failed" } });
      } else {
        ev(s.id, "delivered", fin, "Livraison / ramasse effectuée", { previous_value: { status: "pending" }, new_value: { status: "delivered" } });
      }
      ev(s.id, "status_changed", fin, `Statut modifié : pending → ${s.status}`, { previous_value: { status: "pending" }, new_value: { status: s.status } });
      if (s.packages_picked_up != null) ev(s.id, "pickup_count_recorded", fin, `Nombre réel de colis ramassés enregistré : ${s.packages_picked_up}`, { new_value: { packages_picked_up: s.packages_picked_up } });
      if (s.packages_delivered != null) ev(s.id, "delivery_count_recorded", fin, `Nombre réel de colis déposés enregistré : ${s.packages_delivered}`, { new_value: { packages_delivered: s.packages_delivered } });
    });
    const deplace = cloturee.arrets[3];
    if (deplace) ev(deplace.id, "reordered", at(hier, "06:40"), "Arrêt déplacé par glisser-déposer", { previous_value: { position: 6 }, new_value: { position: 3 } });
    await inserer(admin, "delivery_stop_events", evenements);
  });

  // Ramasses habituelles du chauffeur (proposées chaque matin).
  await facultatif("ramasses habituelles", async () => {
    await inserer(admin, "driver_pickup_templates", [
      { organization_id: orgId, driver_id: userIds.karim, address: "14 rue Carnot, 69190 Saint-Fons", recipient: "Imprimerie du Rhône", phone: "06 39 98 01 03" },
      { organization_id: orgId, driver_id: userIds.karim, address: "18 avenue Charles de Gaulle, 69200 Vénissieux", recipient: "Fleurs & Jardins" },
    ]);
  });
}

// ---------------------------------------------------------------------------
// Planning : modèles de tournées récurrentes
// ---------------------------------------------------------------------------

async function seedModelesPlanning(c: ContexteDemo) {
  const { admin, orgId, userIds, services, vehicleByDriver } = c;
  const { data: routes, error } = await admin.from("tour_routes").select("id, tour_number").eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  await inserer(
    admin,
    "planning_tour_templates",
    ROUTES.filter((r) => (routes ?? []).some((x) => x.tour_number === r.tour)).map((r) => ({
      organization_id: orgId,
      service_id: services[r.service]!.id,
      route_id: routes!.find((x) => x.tour_number === r.tour)!.id,
      name: `Tournée n°${r.tour}`,
      departure_time: r.service === 0 ? "06:30" : "06:45",
      weekdays: r.tour === "V105" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5],
      default_vehicle_id: vehicleByDriver[r.driver]?.id ?? null,
      active: true,
      created_by: userIds.manager,
    })),
  );
}

// ---------------------------------------------------------------------------
// Paie transport (IDCC 16)
// ---------------------------------------------------------------------------

const PROFILS_PAIE: Record<string, { taux: number; pas: number; n1: number; n: number }> = {
  karim: { taux: 13.12, pas: 3.4, n1: 12.5, n: 10 },
  lucas: { taux: 12.85, pas: 2.1, n1: 20, n: 10 },
  nadia: { taux: 12.85, pas: 0, n1: 7.5, n: 10 },
  thomas: { taux: 13.4, pas: 5.2, n1: 24, n: 10 },
  mehdi: { taux: 12.85, pas: 1.6, n1: 15, n: 10 },
  elodie: { taux: 12.85, pas: 2.8, n1: 9, n: 10 },
};

async function seedPaie(c: ContexteDemo) {
  const { admin, orgId, userIds, today, at } = c;
  await inserer(admin, "payroll_settings", {
    organization_id: orgId,
    headcount: 8,
    accident_rate: 5.4,
    mobility_rate: 2,
    prevoyance_salarial_rate: 0.63,
    prevoyance_patronal_rate: 0.63,
    mutuelle_salarial_amount: 0,
    mutuelle_patronal_amount: 0,
    meal_allowance: 16.36,
    single_meal_allowance: 10.07,
    snack_allowance: 8.87,
    overnight_allowance: 52.31,
    ccn_salarial_rate: 0.025,
    ccn_patronal_rate: 0.525,
    health_pmss_salarial_rate: 2.01,
    health_pmss_patronal_rate: 2.01,
    dfs_enabled: false,
    dfs_rate: 17,
    advance_cap_percent: 50,
  });
  const debutMois = `${today.slice(0, 7)}-01`;
  await inserer(
    admin,
    "payroll_profiles",
    Object.entries(PROFILS_PAIE).map(([key, p]) => ({
      user_id: userIds[key],
      organization_id: orgId,
      regime: "courte_distance",
      is_cadre: false,
      coefficient: "138 M",
      hourly_rate: p.taux,
      contractual_hours: 151.67,
      pas_rate: p.pas,
      job_group: "6",
      leave_balance_n1: p.n1,
      leave_balance_n: p.n,
      leave_balance_date: debutMois,
    })),
  );

  // Demandes d'acompte : une acceptée et versée le mois dernier (déduite du bulletin validé),
  // une acceptée ce mois-ci (déduite du prochain bulletin) et une en attente.
  const moisPrecedent = addDays(debutMois, -1).slice(0, 7);
  const debutPrecedent = `${moisPrecedent}-01`;
  await facultatif("demandes d'acompte", async () => {
    await inserer(admin, "salary_advance_requests", [
      { organization_id: orgId, user_id: userIds.karim, period: debutPrecedent, amount_requested: 300, amount_granted: 300, reason: "Réparation de ma voiture", status: "versee", decided_by: userIds.direction, decided_at: at(`${moisPrecedent}-10`, "11:00"), paid_at: `${moisPrecedent}-12` },
      { organization_id: orgId, user_id: userIds.nadia, period: debutMois, amount_requested: 250, amount_granted: 200, reason: "Rentrée scolaire", status: "acceptee", decided_by: userIds.direction, decided_at: at(addDays(today, -2), "09:30"), decision_comment: "Accordé à hauteur de 200 €." },
      { organization_id: orgId, user_id: userIds.lucas, period: debutMois, amount_requested: 250, reason: "Avance sur le salaire du mois", status: "en_attente" },
    ]);
  });

  // Bulletin du mois dernier de Karim, calculé par le moteur de paie, rendu en PDF et validé par la direction.
  await facultatif("bulletin de paie validé", async () => {
    const ctx = await contextePaie(admin, orgId, userIds.karim!, moisPrecedent);
    const variables: VariablesMois = {
      heuresTravaillees: 163,
      heuresAbsenceNonPayee: 0,
      joursCongesPris: 0,
      primes: [{ libelle: "Prime de qualité", montant: 80, soumise: true }],
      nbRepas: 20,
      nbRepasUnique: 0,
      nbCasseCroute: 2,
      nbGrandDeplacement: 0,
      retenues: fusionnerRetenues([], ctx.acomptes.retenues),
      personnesACharge: 1,
      periodesConges: [],
      tauxRepas: null,
      cumulHeuresSupExonereesAnnee: ctx.cumuls.heuresSupExonerees,
    };
    const bulletin = calculerBulletin({ legal: ctx.legal, entreprise: ctx.entreprise, salarie: ctx.salarie, variables });
    const pdf = await genererBulletinPdf(
      donneesBulletinPdf({
        ctx,
        bulletin,
        variables,
        organisation: { name: "Transports Démo", legal_address: "12 rue du Dépôt, 69007 Lyon", convention_collective: "Transports routiers et activités auxiliaires du transport (IDCC 16)" },
        employe: { full_name: "Karim Benali", role_title: "Conducteur messagerie" },
        dossier: { hire_date: "2021-03-01", contract_type: "cdi" },
      }),
    );
    const filePath = `${orgId}/${userIds.karim}/demo-${moisPrecedent}.pdf`;
    const { error: envoi } = await admin.storage.from("payslips").upload(filePath, pdf, { contentType: "application/pdf", upsert: true });
    if (envoi) throw new Error(`PDF : ${envoi.message}`);
    const [bulletinCree] = await inserer(
      admin,
      "payslips",
      {
        organization_id: orgId,
        user_id: userIds.karim,
        period_start: ctx.debut,
        period_end: ctx.fin,
        gross_amount: bulletin.brut,
        net_amount: bulletin.netAPayer,
        net_taxable: bulletin.netImposable,
        pas_amount: bulletin.montantPas,
        employer_cost: bulletin.coutEmployeur,
        overtime_exempt: bulletin.heuresSupExonerees,
        bonus_amount: 80,
        meal_vouchers_amount: 0,
        details: bulletin,
        variables,
        file_path: filePath,
        status: "generated",
        generated_by: userIds.manager,
        generated_at: at(`${ctx.fin}`, "17:00"),
      },
      "id",
    );
    const payslipId = bulletinCree!.id as string;
    await rattacherAcomptes(admin, payslipId, ctx.acomptes.ids);
    // Préparé par l'exploitation, validé ensuite par la direction (trigger payslips_guard_validation).
    const { error } = await admin.from("payslips").update({ validation_status: "valide", validated_by: userIds.direction, validation_comment: "Vérifié, RAS." }).eq("id", payslipId);
    if (error) console.warn("Démo — validation du bulletin ignorée :", error.message);
  });
}

// ---------------------------------------------------------------------------
// Carburant : traitement des écarts
// ---------------------------------------------------------------------------

async function seedEcartsCarburant(c: ContexteDemo) {
  const { admin, orgId, userIds, pleinsAvecEcart } = c;
  const [traite, explique] = pleinsAvecEcart;
  const lignes: Ligne[] = [];
  if (traite) {
    lignes.push({ organization_id: orgId, fuel_entry_id: traite.id, action: "traite", commentaire: "Écart justifié : purge de la pompe après l'intervention sur la cuve.", created_by: userIds.manager });
  }
  if (explique) {
    lignes.push({ organization_id: orgId, fuel_entry_id: explique.id, action: "explication_demandee", commentaire: "L'index avant ne suit pas le plein précédent : pouvez-vous expliquer l'écart ?", created_by: userIds.manager });
    lignes.push({ organization_id: orgId, fuel_entry_id: explique.id, action: "reponse_chauffeur", commentaire: "J'ai dépanné le Master de l'atelier sans saisir le plein, désolé.", created_by: userIds[explique.driver] });
  }
  // Le troisième écart reste « à traiter » pour la démonstration.
  if (lignes.length) await inserer(admin, "fuel_gap_reviews", lignes);
}

/** Construit toutes les données des modules récents. Jamais bloquant pour la démo. */
export async function seedModulesRecents(c: ContexteDemo) {
  await facultatif("rôle manager qui conduit", async () => {
    const { error } = await c.admin.from("users").update({ can_drive: true }).eq("id", c.userIds.manager);
    if (error) throw new Error(error.message);
  });
  await facultatif("Tournée colis", () => seedTourneeColis(c));
  await facultatif("modèles du planning", () => seedModelesPlanning(c));
  await facultatif("paie", () => seedPaie(c));
  await facultatif("traitement des écarts carburant", () => seedEcartsCarburant(c));
}

/** Supprime les PDF de bulletins de la démo (stockage), avant la suppression de l'organisation. */
export async function supprimerFichiersDemo(admin: SupabaseClient, orgId: string) {
  try {
    const { data: dossiers } = await admin.storage.from("payslips").list(orgId);
    for (const dossier of dossiers ?? []) {
      const { data: fichiers } = await admin.storage.from("payslips").list(`${orgId}/${dossier.name}`);
      const chemins = (fichiers ?? []).map((f) => `${orgId}/${dossier.name}/${f.name}`);
      if (chemins.length) await admin.storage.from("payslips").remove(chemins);
    }
  } catch (e) {
    console.warn("Démo — nettoyage des bulletins ignoré :", e instanceof Error ? e.message : e);
  }
}
