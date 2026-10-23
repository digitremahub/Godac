import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { addDays, parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { lireArrets } from "@/lib/arrets/serveur";
import {
  construireEquipe,
  construireVehicules,
  fusionner,
  STATUTS_AMENDE_OUVERTE,
  STATUTS_CONTESTATION_OUVERTE,
  type ArretJour,
  type CongeJour,
  type DocumentVehicule,
  type DossierOuvert,
  type EntreePlanningJour,
  type MembreBrut,
  type MembreEquipe,
  type VehiculeBrut,
  type VehiculeService,
} from "@/lib/accueil/chef-equipe";

/**
 * Données de l'accueil du manager (chef d'équipe). Toutes les lectures
 * passent par le client de l'utilisateur (la RLS reste l'autorité) ET
 * sont filtrées explicitement sur ses services : aucune donnée d'un
 * autre service. Chaque source est indépendante : en erreur, elle donne
 * `erreur: true` (message discret à l'écran) sans casser la page ; une
 * table ou une colonne absente (migration non appliquée) est tolérée
 * comme une liste vide. Listes plafonnées, aucune requête par ligne.
 */

type Db = SupabaseClient;

/** Plafond de lignes par liste. */
export const PLAFOND = 50;
const NIL = "00000000-0000-0000-0000-000000000000";

export interface Source<T> {
  data: T;
  /** La lecture a échoué (hors schéma manquant) : afficher un message discret. */
  erreur: boolean;
  /** La liste a atteint le plafond : il en reste peut-être. */
  tronquee?: boolean;
}

type Reponse = { data: unknown; error: { code?: string | null; message?: string | null } | null };

/** Exécute une lecture : erreur de schéma → vide silencieux ; autre erreur ou exception → `erreur`. */
async function lire<T>(requete: PromiseLike<Reponse>, repli: T, nom: string): Promise<Source<T>> {
  try {
    const r = await requete;
    if (r.error) {
      if (estSchemaManquant(r.error)) return { data: repli, erreur: false };
      console.warn(`[accueil manager] ${nom} : lecture impossible`, r.error.message);
      return { data: repli, erreur: true };
    }
    return { data: (r.data ?? repli) as T, erreur: false };
  } catch (e) {
    console.warn(`[accueil manager] ${nom} : exception`, e instanceof Error ? e.message : e);
    return { data: repli, erreur: true };
  }
}

const ids = (l: readonly string[]) => (l.length > 0 ? [...l] : [NIL]);

export interface DonneesEquipe {
  equipe: MembreEquipe[];
  jour: string;
}


export interface DonneesChefEquipe {
  /** Aucun service rattaché : rien à observer. */
  sansService: boolean;
  serviceIds: string[];
  jour: string;
  equipe: Source<MembreEquipe[]>;
  vehicules: Source<VehiculeService[]>;
  amendes: Source<DossierOuvert[]> | null;
  contestations: Source<DossierOuvert[]> | null;
  /** Congés en attente de l'équipe (null : non demandé). */
  congesEnAttente: Source<number> | null;
  /** Interventions d'entretien prévues sur les véhicules du service (null : non demandé). */
  entretiensEnAttente: Source<number> | null;
}

interface LigneMembre {
  id: string;
  full_name: string;
  role: string;
  can_drive?: boolean | null;
  user_services: { service_id: string }[] | null;
}

/** Rôles qui ne font pas partie d'une équipe de terrain. */
const ROLES_HORS_EQUIPE = new Set(["direction", "comptable", "exploitation"]);

export async function chargerAccueilChefEquipe(
  supabase: Db,
  moi: { id: string; organization_id: string },
  options: { amendes: boolean; contestations: boolean; conges: boolean; entretiens: boolean },
): Promise<DonneesChefEquipe> {
  const maintenant = new Date();
  const jour = parisCalendarDate(maintenant.toISOString());
  const debutJour = parisWallTimeToUtcISOString(jour, "00:00");
  const finJour = parisWallTimeToUtcISOString(addDays(jour, 1), "00:00");

  // 1. Mes services (user_services).
  const services = await lire<{ service_id: string }[]>(supabase.from("user_services").select("service_id").eq("user_id", moi.id), [], "services");
  const serviceIds = services.data.map((s) => s.service_id);
  if (serviceIds.length === 0) {
    const vide = <T,>(data: T): Source<T> => ({ data, erreur: services.erreur });
    return {
      sansService: !services.erreur,
      serviceIds,
      jour,
      equipe: vide<MembreEquipe[]>([]),
      vehicules: vide<VehiculeService[]>([]),
      amendes: null,
      contestations: null,
      congesEnAttente: null,
      entretiensEnAttente: null,
    };
  }

  // 2. Première vague, en parallèle : équipe, planning du jour, congés, véhicules.
  const [membresR, entreesJourR, entreesEnCoursR, congesR, vehiculesR] = await Promise.all([
    lire<LigneMembre[]>(
      supabase
        .from("users")
        .select("id, full_name, role, can_drive, user_services!inner(service_id)")
        .eq("organization_id", moi.organization_id)
        .eq("active", true)
        .in("user_services.service_id", serviceIds)
        .neq("id", moi.id)
        .order("full_name")
        .limit(PLAFOND * 2),
      [],
      "équipe",
    ),
    lire<EntreePlanningJour[]>(
      supabase
        .from("planning_entries")
        .select("driver_id, vehicle_id, tour_number, status, start_at, vehicles(registration)")
        .eq("organization_id", moi.organization_id)
        .in("service_id", serviceIds)
        .gte("start_at", debutJour)
        .lt("start_at", finJour)
        .limit(PLAFOND * 4),
      [],
      "planning du jour",
    ),
    // Tournée démarrée avant minuit et toujours en cours.
    lire<EntreePlanningJour[]>(
      supabase
        .from("planning_entries")
        .select("driver_id, vehicle_id, tour_number, status, start_at, vehicles(registration)")
        .eq("organization_id", moi.organization_id)
        .in("service_id", serviceIds)
        .eq("status", "in_progress")
        .limit(PLAFOND * 2),
      [],
      "tournées en cours",
    ),
    lire<CongeJour[]>(
      supabase
        .from("leave_requests")
        .select("driver_id, start_date, end_date, status")
        .eq("organization_id", moi.organization_id)
        .in("service_id", serviceIds)
        .eq("status", "approved")
        .lte("start_date", jour)
        .gte("end_date", jour)
        .limit(PLAFOND * 2),
      [],
      "congés",
    ),
    lire<(VehiculeBrut & { service_id: string | null })[]>(
      supabase
        .from("vehicles")
        .select("id, registration, type, status, service_id")
        .eq("organization_id", moi.organization_id)
        .in("service_id", serviceIds)
        .order("registration")
        .limit(PLAFOND * 2),
      [],
      "véhicules",
    ),
  ]);

  const membres: MembreBrut[] = membresR.data
    .filter((m) => !ROLES_HORS_EQUIPE.has(m.role))
    .map((m) => ({ id: m.id, full_name: m.full_name, role: m.role, can_drive: m.can_drive, serviceIds: (m.user_services ?? []).map((s) => s.service_id) }));
  const membreIds = membres.map((m) => m.id);
  const vehicules = vehiculesR.data.filter((v) => v.service_id && serviceIds.includes(v.service_id));
  const vehiculeIds = vehicules.map((v) => v.id);

  // 3. Seconde vague, en parallèle : ce qui dépend de l'équipe ou des véhicules.
  const [arretsR, interventionsR, documentsR, amendesR, contestationsR, congesAttenteR] = await Promise.all([
    (async (): Promise<Source<ArretJour[]>> => {
      if (membreIds.length === 0) return { data: [], erreur: false };
      try {
        const r = await lireArrets(supabase, { userIds: membreIds, du: jour, au: jour, limite: PLAFOND * 2 });
        return { data: r.lignes.map((l) => ({ userId: l.userId, du: l.du, au: l.au, statut: l.statut })), erreur: false };
      } catch (e) {
        console.warn("[accueil manager] arrêts : exception", e instanceof Error ? e.message : e);
        return { data: [], erreur: true };
      }
    })(),
    vehiculeIds.length === 0
      ? Promise.resolve<Source<{ vehicle_id: string; status: string }[]>>({ data: [], erreur: false })
      : lire<{ vehicle_id: string; status: string }[]>(
          supabase.from("vehicle_interventions").select("vehicle_id, status").in("vehicle_id", vehiculeIds).in("status", ["scheduled", "in_progress"]).limit(PLAFOND * 2),
          [],
          "entretiens",
        ),
    vehiculeIds.length === 0
      ? Promise.resolve<Source<DocumentVehicule[]>>({ data: [], erreur: false })
      : lire<DocumentVehicule[]>(
          supabase
            .from("vehicle_documents")
            .select("vehicle_id, doc_type, expires_on")
            .in("vehicle_id", vehiculeIds)
            .not("expires_on", "is", null)
            .lte("expires_on", addDays(jour, 30))
            .limit(PLAFOND * 4),
          [],
          "documents des véhicules",
        ),
    options.amendes ? chargerAmendes(supabase, serviceIds, membreIds, moi.id) : Promise.resolve(null),
    options.contestations ? chargerContestations(supabase, membreIds, moi.id) : Promise.resolve(null),
    options.conges && membreIds.length > 0
      ? lire<{ id: string }[]>(
          supabase
            .from("leave_requests")
            .select("id")
            .eq("organization_id", moi.organization_id)
            .in("service_id", serviceIds)
            .in("driver_id", membreIds)
            .eq("status", "pending")
            .limit(PLAFOND),
          [],
          "congés à valider",
        )
      : Promise.resolve<Source<{ id: string }[]> | null>(options.conges ? { data: [], erreur: false } : null),
  ]);

  const equipe = construireEquipe({
    membres,
    entrees: fusionnerEntrees(entreesJourR.data, entreesEnCoursR.data),
    conges: congesR.data,
    arrets: arretsR.data,
    jour,
  });
  const equipeErreur = membresR.erreur || entreesJourR.erreur || entreesEnCoursR.erreur || congesR.erreur || arretsR.erreur;

  const enIntervention = new Set(interventionsR.data.filter((i) => i.status === "in_progress").map((i) => i.vehicle_id));
  const chauffeurs = new Map(membres.map((m) => [m.id, m.full_name]));
  const tournees = entreesEnCoursR.data.concat(entreesJourR.data.filter((e) => e.status === "in_progress")).map((e) => ({ vehicle_id: e.vehicle_id ?? null, chauffeur: e.driver_id ? (chauffeurs.get(e.driver_id) ?? null) : null }));
  const listeVehicules = construireVehicules({ vehicules, tournees, vehiculesEnIntervention: enIntervention, documents: documentsR.data, aujourdhui: jour });

  return {
    sansService: false,
    serviceIds,
    jour,
    equipe: { data: equipe, erreur: equipeErreur, tronquee: membresR.data.length >= PLAFOND * 2 },
    vehicules: { data: listeVehicules, erreur: vehiculesR.erreur, tronquee: vehiculesR.data.length >= PLAFOND * 2 },
    amendes: amendesR,
    contestations: contestationsR,
    congesEnAttente: congesAttenteR ? { data: congesAttenteR.data.length, erreur: congesAttenteR.erreur } : null,
    entretiensEnAttente: options.entretiens ? { data: interventionsR.data.filter((i) => i.status === "scheduled").length, erreur: interventionsR.erreur } : null,
  };
}

function fusionnerEntrees(a: readonly EntreePlanningJour[], b: readonly EntreePlanningJour[]): EntreePlanningJour[] {
  // Même tournée lue deux fois (jour + en cours) : une seule ligne par (chauffeur, tournée, début).
  const vus = new Set<string>();
  const out: EntreePlanningJour[] = [];
  for (const e of [...b, ...a]) {
    const cle = `${e.driver_id}|${e.tour_number}|${e.start_at}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push(e);
  }
  return out;
}

// ── Amendes ouvertes : véhicules de mes services ou chauffeurs de mon équipe ──

interface LigneAmende {
  id: string;
  infraction_at: string | null;
  status: string;
  driver_id: string | null;
  vehicles: { registration: string } | null;
  driver: { full_name: string; role: string } | null;
}

const SELECTION_AMENDE = "id, infraction_at, status, driver_id, vehicles(registration), driver:users!fines_driver_id_fkey(full_name, role)";

async function chargerAmendes(supabase: Db, serviceIds: string[], membreIds: string[], moiId: string): Promise<Source<DossierOuvert[]>> {
  const concernes = [...membreIds, moiId];
  const [parVehicule, parChauffeur] = await Promise.all([
    lire<LigneAmende[]>(
      supabase
        .from("fines")
        .select(SELECTION_AMENDE.replace("vehicles(registration)", "vehicles!inner(registration, service_id)"))
        .in("status", [...STATUTS_AMENDE_OUVERTE])
        .in("vehicles.service_id", serviceIds)
        .order("infraction_at", { ascending: true })
        .limit(PLAFOND),
      [],
      "amendes (véhicules)",
    ),
    lire<LigneAmende[]>(
      supabase.from("fines").select(SELECTION_AMENDE).in("status", [...STATUTS_AMENDE_OUVERTE]).in("driver_id", ids(concernes)).order("infraction_at", { ascending: true }).limit(PLAFOND),
      [],
      "amendes (chauffeurs)",
    ),
  ]);
  const lignes = fusionner(parVehicule.data, parChauffeur.data);
  return {
    data: lignes.map((f) => ({
      id: f.id,
      intitule: f.vehicles?.registration ?? "Amende",
      statut: f.status,
      date: f.infraction_at,
      personne: f.driver?.full_name ?? null,
      personneId: f.driver_id,
      personneRole: f.driver?.role ?? null,
    })),
    erreur: parVehicule.erreur || parChauffeur.erreur,
    tronquee: parVehicule.data.length >= PLAFOND || parChauffeur.data.length >= PLAFOND,
  };
}

// ── Contestations ouvertes : chauffeurs de mon équipe (désigné ou suggéré) ──

interface LigneContestation {
  id: string;
  status: string;
  client_name: string | null;
  reference: string | null;
  created_at: string;
  driver_id: string | null;
  suggested_driver_id: string | null;
  driver: { full_name: string; role: string } | null;
}

async function chargerContestations(supabase: Db, membreIds: string[], moiId: string): Promise<Source<DossierOuvert[]>> {
  const concernes = ids([...membreIds, moiId]);
  const requete = (colonne: "driver_id" | "suggested_driver_id") =>
    lire<LigneContestation[]>(
      supabase
        .from("customer_disputes")
        .select("id, status, client_name, reference, created_at, driver_id, suggested_driver_id, driver:users!customer_disputes_driver_id_fkey(full_name, role)")
        .in("status", [...STATUTS_CONTESTATION_OUVERTE])
        .in(colonne, concernes)
        .order("created_at", { ascending: true })
        .limit(PLAFOND),
      [],
      `contestations (${colonne})`,
    );
  const [designees, suggerees] = await Promise.all([requete("driver_id"), requete("suggested_driver_id")]);
  const lignes = fusionner(designees.data, suggerees.data);
  return {
    data: lignes.map((c) => ({
      id: c.id,
      intitule: c.client_name ?? c.reference ?? "Réclamation",
      statut: c.status,
      date: c.created_at,
      personne: c.driver?.full_name ?? null,
      personneId: c.driver_id,
      personneRole: c.driver?.role ?? null,
    })),
    erreur: designees.erreur || suggerees.erreur,
    tronquee: designees.data.length >= PLAFOND || suggerees.data.length >= PLAFOND,
  };
}
