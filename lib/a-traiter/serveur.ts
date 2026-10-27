import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { urlDe } from "@/lib/acces/catalogue";
import { ecranOuvrable } from "@/lib/acces/tuiles-accueil";
import { chargerEcartsATraiter } from "@/lib/fuel/ecarts-serveur";
import { compterDirection } from "@/lib/hierarchie/serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { LIBELLES_CONTROLE, type CodeControle, type PointARegler } from "@/lib/ticpe/controles";
import { prochaineEcheance } from "@/lib/ticpe/echeances";
import { controlesDeLaPeriode } from "@/lib/ticpe/periode-serveur";
import { chargerParametresTicpe } from "@/lib/ticpe/serveur";
import { chargerTourneesSuivies, type TourneeSuivie } from "@/lib/exploitation/suivi-serveur";
import { lirePlanningDuJour, type LignePlanningJour } from "@/lib/exploitation/planning-jour";
import { fenetreAujourdhuiDemain } from "@/lib/exploitation/surveillance";
import { dansLePerimetre } from "@/lib/roles/perimetre";
import { bulletinsAValiderParMois, suiteMoisPaie } from "@/lib/paie/accueil";
import { LIBELLES_ETAT, aSurveiller, libelleRetard, libelleSignal, trierRetards } from "@/lib/exploitation/retards";
import { lireFusions } from "@/lib/planning/fusion-serveur";
import { resumeRepartition, texteAAttribuer } from "@/lib/planning/fusion";
import { parisDay } from "@/lib/utils/paris-time";
import { addDays } from "@/lib/planning/dates";
import { paysOrganisation } from "@/lib/pays/serveur";
import { MENTION_A_VALIDER, reglesTempsTravail } from "@/lib/pays/temps-travail";
import { LIBELLE_CONTROLE_REPOS, controlerTempsTravail, joursDepuisPointages } from "@/lib/time-clock/repos";
import { estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { echeancesSouhaitees } from "@/lib/alerts/echeances";
import { lireAmendesAEcheance, lireDocumentsVehicules } from "@/lib/alerts/echeances-serveur";
import { PLAFOND_PAR_SOURCE, ROLES_A_TRAITER, construireListe, typeVisiblePour, type ElementBrut, type PersonneConnue, type ResultatListe, type TypeATraiter } from "@/lib/a-traiter/logique";

/**
 * Chargement de « À traiter aujourd'hui » : UNE requête plafonnée par
 * source (pas de N+1), sous la RLS de la personne connectée (exploitation
 * et direction : toute l'entreprise). Une source dont l'écran ne s'ouvre
 * pas (rôle, module) n'est pas lue ; une table ou une colonne absente
 * (migration pas encore appliquée) est ignorée en silence ; une autre
 * erreur ou un délai dépassé n'empêche jamais le reste de s'afficher :
 * la source est seulement signalée, discrètement.
 */

type Db = SupabaseClient;

export interface OptionsChargement {
  /** Écarts carburant déjà comptés par le tableau de bord (évite de relire les pleins). */
  ecartsIds?: readonly string[];
  /** Délai maximal par source, en millisecondes. */
  delaiMs?: number;
  maintenant?: Date;
  /** Planning du jour déjà lu par l'accueil (une seule lecture pour toute la page). */
  planningDuJour?: () => Promise<LignePlanningJour[]>;
  /** Tournées colis suivies déjà lues par l'accueil. */
  tourneesSuivies?: () => Promise<TourneeSuivie[]>;
}

export interface ResultatATraiter extends ResultatListe {
  /** Sources qui n'ont pas pu être lues (libellés courts). */
  erreurs: string[];
  /** Types dont la lecture a atteint le plafond : le compteur est « N+ ». */
  plafonnes: TypeATraiter[];
}

const DELAI_PAR_DEFAUT_MS = 8000;
const LOT_REQUETE = 80;

interface Lecture {
  brutes: ElementBrut[];
  plafonne?: boolean;
}

interface Source {
  type: TypeATraiter;
  nom: string;
  /** Écran du catalogue : la source n'est lue que s'il s'ouvre pour cette personne. */
  ecran: string;
  lire: () => Promise<Lecture>;
}

// ── Aides ───────────────────────────────────────────────────────────

class DelaiDepasse extends Error {}

function avecDelai<T>(p: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new DelaiDepasse("délai dépassé")), ms);
  });
  return Promise.race([p, limite]).finally(() => clearTimeout(minuteur));
}

/** Lignes d'une requête ; schéma absent = aucune ligne, autre erreur = exception. */
async function lire<T = any>(requete: PromiseLike<{ data: T[] | null; error: { code?: string | null; message: string } | null }>): Promise<T[]> {
  const { data, error } = await requete;
  if (error) {
    if (estSchemaManquant(error)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

function lots<T>(liste: readonly T[], taille: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) r.push(liste.slice(i, i + taille));
  return r;
}

/** Immatriculation d'une jointure `vehicles(registration)` (objet ou tableau selon le typage). */
function immat(v: unknown): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  return (x as { registration?: string } | null | undefined)?.registration ?? null;
}

const court = (texte: string | null | undefined, n = 90) => {
  const t = (texte ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const jourCourt = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });
const jourDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

// ── Chargement ──────────────────────────────────────────────────────

export async function chargerATraiter(supabase: Db, appUser: AppUser, modules: ReadonlySet<string>, options: OptionsChargement = {}): Promise<ResultatATraiter> {
  const maintenant = options.maintenant ?? new Date();
  const delai = options.delaiMs ?? DELAI_PAR_DEFAUT_MS;
  const ctx = { role: appUser.role, modules, conduit: appUser.conduit };
  // Garde serveur : « À traiter » n'existe que pour l'encadrement (jamais le chauffeur ni le comptable), quel que soit l'appelant.
  if (!ROLES_A_TRAITER.includes(appUser.role) || !ecranOuvrable("dashboard.a_traiter", ctx)) return { elements: [], verrouilles: [], erreurs: [], plafonnes: [] };
  const org = appUser.organization_id;
  const aujourdhui = parisDay(maintenant);
  const { debutJour, debutDemain, finDemain } = fenetreAujourdhuiDemain(maintenant);
  // Une tournée « non démarrée » : l'heure prévue est passée depuis au moins 15 minutes.
  const limiteRetard = new Date(maintenant.getTime() - 15 * 60000).toISOString();
  // Services du manager, lus une fois : planning et demandes d'entretien (lecture ouverte à l'organisation en base) en dépendent.
  let servicesPromesse: Promise<string[]> | null = null;
  const mesServices = () => {
    servicesPromesse ??= (async () => {
      const { data } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
      return ((data ?? []) as { service_id: string }[]).map((x) => x.service_id);
    })();
    return servicesPromesse;
  };
  // Planning lu une fois pour les quatre sources de tournées ; manager : ses services seulement (en plus de la RLS).
  let planningPromesse: Promise<LignePlanningJour[]> | null = null;
  const planning = () => {
    planningPromesse ??= (async () => {
      const lignes = await (options.planningDuJour ?? (() => lirePlanningDuJour(supabase, maintenant)))();
      if (appUser.role !== "manager") return lignes;
      const mes = await mesServices();
      return lignes.filter((l) => dansLePerimetre(appUser.role, mes, l.service_id));
    })();
    return planningPromesse;
  };
  const lienPlanning = (id: string) => `${urlDe("exploitation.planning")}?entry=${id}`;

  const toutes: Source[] = [
    {
      // Écarts carburant : le compteur global existant, puis le détail des plus anciens.
      type: "ecart_carburant",
      nom: "écarts carburant",
      ecran: "carburant.pleins",
      lire: async () => {
        const tous = options.ecartsIds ? [...options.ecartsIds] : (await chargerEcartsATraiter(supabase)).ids;
        // Les ids sont du plus récent au plus ancien : on garde les plus anciens, les plus urgents.
        const gardes = tous.slice(-PLAFOND_PAR_SOURCE);
        const pages = await Promise.all(
          lots(gardes, LOT_REQUETE).map((ids) => lire(supabase.from("fuel_entries").select("id, occurred_at, driver_id, liters, vehicles(registration)").in("id", ids))),
        );
        return {
          plafonne: tous.length > PLAFOND_PAR_SOURCE,
          brutes: pages.flat().map((p) => ({
            type: "ecart_carburant" as const,
            id: p.id,
            libelle: `Écart carburant${immat(p.vehicles) ? ` · ${immat(p.vehicles)}` : ""}`,
            detail: `{nom} · plein du ${jourCourt(p.occurred_at)}${p.liters !== null ? ` · ${Number(p.liters).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} L` : ""}`,
            depuis: p.occurred_at,
            ecran: "carburant.pleins",
            href: `${urlDe("carburant.pleins")}?plein=${p.id}`,
            auteurId: p.driver_id,
            personneId: p.driver_id,
            groupable: true,
            litres: p.liters === null ? null : Number(p.liters),
            vehicule: immat(p.vehicles),
          })),
        };
      },
    },
    {
      // Amendes à attribuer : le responsable suggéré se confirme en un clic, sinon il se choisit sur l'écran.
      type: "amende",
      nom: "amendes",
      ecran: "flotte.amendes",
      lire: async () => {
        const base = "id, infraction_at, amount, reference, created_at, vehicles(registration)";
        const requete = (colonnes: string) => supabase.from("fines").select(colonnes).eq("status", "pending_identification").order("created_at", { ascending: true }).limit(PLAFOND_PAR_SOURCE);
        let essai = await requete(`${base}, suggested_driver_id, payment_deadline`);
        // Colonnes de la migration 20261026000003 absentes : repli sur les colonnes historiques.
        if (essai.error && estSchemaManquant(essai.error)) essai = await requete(base);
        if (essai.error) {
          if (estSchemaManquant(essai.error)) return { brutes: [] };
          throw new Error(essai.error.message);
        }
        const rows = (essai.data ?? []) as any[];
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((f) => ({
            type: "amende" as const,
            id: f.id,
            libelle: `Amende à attribuer${immat(f.vehicles) ? ` · ${immat(f.vehicles)}` : ""}`,
            detail: `${euros(Number(f.amount))} · infraction du ${jourCourt(f.infraction_at)}${f.suggested_driver_id ? " · responsable suggéré : {nom}" : " · responsable à choisir"}`,
            depuis: f.created_at,
            echeance: f.payment_deadline ?? null,
            ecran: "flotte.amendes",
            href: urlDe("flotte.amendes"),
            auteurId: f.suggested_driver_id ?? null,
            personneId: f.suggested_driver_id ?? null,
            choixLibre: true,
            groupable: Boolean(f.suggested_driver_id),
          })),
        };
      },
    },
    {
      // Demandes d'entretien en attente de prise en charge (statut « planifiée »).
      type: "entretien",
      nom: "demandes d'entretien",
      ecran: "flotte.entretien",
      lire: async () => {
        const rows = await lire<any>(
          supabase
            .from("vehicle_interventions")
            .select("id, type, urgency, created_at, requested_by, vehicles(registration, service_id)")
            .eq("status", "scheduled")
            .order("created_at", { ascending: true })
            .limit(PLAFOND_PAR_SOURCE),
        );
        // La lecture des interventions est ouverte à toute l'organisation (RLS) : le manager ne voit que les véhicules de ses services.
        const mes = appUser.role === "manager" ? await mesServices() : [];
        const dansMesServices = (r: any) => {
          const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
          return dansLePerimetre(appUser.role, mes, v?.service_id);
        };
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.filter(dansMesServices).map((r) => ({
            type: "entretien" as const,
            id: r.id,
            libelle: `Entretien${immat(r.vehicles) ? ` · ${immat(r.vehicles)}` : ""}`,
            detail: court(r.type),
            depuis: r.created_at,
            critique: r.urgency === "critical" || r.urgency === "high",
            ecran: "flotte.entretien",
            href: urlDe("flotte.entretien"),
            auteurId: r.requested_by ?? null,
            groupable: true,
          })),
        };
      },
    },
    {
      // Demandes de rendez-vous (intranet) : décidées par l'encadrement, hiérarchie comprise.
      type: "demande",
      nom: "demandes de rendez-vous",
      ecran: "communication.intranet",
      lire: async () => {
        const rows = await lire<any>(
          supabase.from("meeting_requests").select("id, reason, requested_by, preferred_date, created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(PLAFOND_PAR_SOURCE),
        );
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((r) => ({
            type: "demande" as const,
            id: r.id,
            libelle: "Demande de rendez-vous · {nom}",
            detail: court(r.reason),
            depuis: r.created_at,
            echeance: r.preferred_date ?? null,
            ecran: "communication.intranet",
            href: urlDe("communication.intranet"),
            auteurId: r.requested_by,
            personneId: r.requested_by,
          })),
        };
      },
    },
    {
      // Demandes d'assistance adressées au gestionnaire (celles pour le support GODAC ne sont pas les siennes).
      type: "demande",
      nom: "demandes d'assistance",
      ecran: "communication.assistance",
      lire: async () => {
        const rows = await lire<any>(
          supabase
            .from("support_requests")
            .select("id, question, requested_by, created_at")
            .eq("status", "open")
            .eq("recipient", "gestionnaire")
            .order("created_at", { ascending: true })
            .limit(PLAFOND_PAR_SOURCE),
        );
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((r) => ({
            type: "demande" as const,
            id: r.id,
            libelle: "Demande d'assistance · {nom}",
            detail: court(r.question),
            depuis: r.created_at,
            ecran: "communication.assistance",
            href: urlDe("communication.assistance"),
            auteurId: r.requested_by,
            personneId: r.requested_by,
          })),
        };
      },
    },
    {
      // Contrôles TICPE bloquants de la prochaine échéance, regroupés par nature de point.
      type: "ticpe",
      nom: "contrôles TICPE",
      ecran: "carburant.ticpe_controles",
      lire: async () => {
        const p = await chargerParametresTicpe(supabase, org);
        if (p.migrationManquante) return { brutes: [] };
        const echeance = prochaineEcheance(aujourdhui, p.reglages);
        const { points } = await controlesDeLaPeriode(supabase, org, echeance.periode);
        const parCode = new Map<CodeControle, PointARegler[]>();
        for (const pt of points.filter((x) => x.gravite === "bloquant")) parCode.set(pt.code, [...(parCode.get(pt.code) ?? []), pt]);
        return {
          brutes: [...parCode.entries()].map(([code, pts]) => ({
            type: "ticpe" as const,
            id: `${echeance.periode.cle}:${code}`,
            libelle: pts.length === 1 ? `TICPE : ${pts[0]!.titre}` : `TICPE : ${pts.length} × ${LIBELLES_CONTROLE[code].toLowerCase()}`,
            detail: pts.length === 1 ? pts[0]!.detail : `Bloquant avant la déclaration · ${echeance.periode.libelle}`,
            echeance: echeance.dateLimite,
            ecran: "carburant.ticpe_controles",
            href: pts.length === 1 ? pts[0]!.lien : urlDe("carburant.ticpe_controles"),
          })),
        };
      },
    },
    {
      // Tournées d'aujourd'hui et de demain sans chauffeur (hors tournées fermées : elles ne roulent pas).
      type: "tournee_sans_chauffeur",
      nom: "tournées sans chauffeur",
      ecran: "exploitation.planning",
      lire: async () => {
        const rows = (await planning()).filter((t) => t.status === "planned" && !t.driver_id && t.tour_open !== false && t.start_at >= debutJour && t.start_at < finDemain).slice(0, PLAFOND_PAR_SOURCE);
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((t) => ({
            type: "tournee_sans_chauffeur" as const,
            id: t.id,
            libelle: `Tournée ${t.tour_number} sans chauffeur${t.start_at >= debutDemain ? " demain" : ""}`,
            detail: `Départ prévu à ${heure(t.start_at)}${immat(t.vehicles) ? ` · ${immat(t.vehicles)}` : ""}`,
            echeance: t.start_at,
            ecran: "exploitation.planning",
            href: lienPlanning(t.id),
          })),
        };
      },
    },
    {
      // Tournées fusionnées du jour (lundi) dont des villages ou des ramasses sont encore « À attribuer ».
      type: "repartition_a_attribuer",
      nom: "tournées fusionnées à répartir",
      ecran: "exploitation.planning",
      lire: async () => {
        const rows = (await planning()).filter((t) => t.start_at >= debutJour && t.start_at < debutDemain).slice(0, PLAFOND_PAR_SOURCE);
        // Table absente (migration 20261105000001 pas appliquée) : aucune fusion, source vide.
        const fusions = await lireFusions(supabase, org, rows.map((r) => r.id));
        return {
          brutes: rows.flatMap((t) => {
            const f = fusions.get(t.id);
            if (!f) return [];
            const resume = resumeRepartition([...f.elements.villages, ...f.elements.ramasses], f.lignes);
            if (!resume.aAttribuer) return [];
            return [
              {
                type: "repartition_a_attribuer" as const,
                id: t.id,
                libelle: `Tournée fusionnée ${t.tour_number} à répartir`,
                detail: `${texteAAttribuer(resume)} · départ prévu à ${heure(t.start_at)}`,
                echeance: t.start_at,
                ecran: "exploitation.planning",
                href: lienPlanning(t.id),
              },
            ];
          }),
        };
      },
    },
    {
      // Tournées planifiées du jour, avec chauffeur, pas démarrées alors que l'heure prévue est passée.
      type: "tournee_non_demarree",
      nom: "tournées non démarrées",
      ecran: "exploitation.planning",
      lire: async () => {
        const rows = (await planning()).filter((t) => t.status === "planned" && t.driver_id && t.start_at >= debutJour && t.start_at < limiteRetard).slice(0, PLAFOND_PAR_SOURCE);
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((t) => ({
            type: "tournee_non_demarree" as const,
            id: t.id,
            libelle: `Tournée ${t.tour_number} non démarrée`,
            detail: `{nom} · prévue à ${heure(t.start_at)}${immat(t.vehicles) ? ` · ${immat(t.vehicles)}` : ""}`,
            echeance: t.start_at,
            // Plus d'une demi-heure de retard : urgent.
            critique: maintenant.getTime() - Date.parse(t.start_at) >= 30 * 60000,
            ecran: "exploitation.planning",
            href: lienPlanning(t.id),
            personneId: t.driver_id,
          })),
        };
      },
    },
    {
      // Tournées en cours en retard probable, à surveiller ou dont le chauffeur n'a plus de signal.
      // Périmètre du suivi : un manager ne voit que les chauffeurs de ses services.
      type: "tournee_en_retard",
      nom: "retards en cours",
      ecran: "exploitation.suivi",
      lire: async () => {
        // Lecture seule : les alertes de retard sont écrites par le cron de surveillance, jamais au rendu d'une page.
        const tournees = (await (options.tourneesSuivies ?? (() => chargerTourneesSuivies(supabase, appUser, { statuts: ["in_progress"], maintenant })))()).filter((t) => t.statut === "in_progress");
        const retards = trierRetards(tournees.filter((t) => t.retard && aSurveiller(t.retard)).map((t) => ({ ...t.retard!, tournee: t })));
        return {
          brutes: retards.map(({ tournee: t, ...r }) => ({
            type: "tournee_en_retard" as const,
            id: t.id,
            libelle: `${t.nom ?? "Tournée"} · ${LIBELLES_ETAT[r.etat].toLowerCase()}`,
            detail: [t.chauffeur, r.retardMin > 0 ? `retard estimé ${libelleRetard(r.retardMin)}` : null, `${r.arretsRestants} arrêt${r.arretsRestants > 1 ? "s" : ""} restant${r.arretsRestants > 1 ? "s" : ""}`, r.horsLigne ? `position ${libelleSignal(r.signal, r.derniereMajMin)}` : null].filter(Boolean).join(" · "),
            critique: r.palier === "en_retard",
            ecran: "exploitation.suivi",
            href: `${urlDe("exploitation.suivi")}?tournee=${t.id}`,
          })),
        };
      },
    },
    {
      // Tickets de carburant à relire (OCR) ou à valider.
      type: "ticket_ocr",
      nom: "tickets à vérifier",
      ecran: "carburant.revue_ocr",
      lire: async () => {
        const rows = await lire<any>(
          supabase
            .from("fuel_entries")
            .select("id, occurred_at, liters, driver_id, vehicles(registration)")
            .in("status", ["pending_ocr", "awaiting_validation"])
            .order("occurred_at", { ascending: true })
            .limit(PLAFOND_PAR_SOURCE),
        );
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((p) => ({
            type: "ticket_ocr" as const,
            id: p.id,
            libelle: `Ticket à vérifier${immat(p.vehicles) ? ` · ${immat(p.vehicles)}` : ""}`,
            detail: `{nom} · plein du ${jourCourt(p.occurred_at)}${p.liters !== null ? ` · ${Number(p.liters).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} L` : ""}`,
            depuis: p.occurred_at,
            ecran: "carburant.revue_ocr",
            href: urlDe("carburant.revue_ocr"),
            personneId: p.driver_id,
          })),
        };
      },
    },
    {
      // Papiers des véhicules (contrôle technique, assurance, licence…) à renouveler dans 30 jours ou moins, ou échus.
      // Calculés directement depuis les documents (les mêmes règles que le cron des échéances) : visibles même sans la migration des alertes.
      type: "echeance_vehicule",
      nom: "échéances des papiers des véhicules",
      ecran: "flotte.vehicules",
      lire: async () => {
        const documents = await lireDocumentsVehicules(supabase, org);
        // La lecture des papiers est ouverte à l'organisation (RLS) : le manager ne voit que les véhicules de ses services.
        const mes = appUser.role === "manager" ? await mesServices() : [];
        const dansMesServices = (e: { serviceId: string | null }) => dansLePerimetre(appUser.role, mes, e.serviceId);
        const echeances = echeancesSouhaitees(documents, [], aujourdhui).filter(dansMesServices).slice(0, PLAFOND_PAR_SOURCE);
        return {
          plafonne: echeances.length >= PLAFOND_PAR_SOURCE,
          brutes: echeances.map((e) => ({
            type: "echeance_vehicule" as const,
            id: e.cle,
            libelle: e.message.split(" : ")[0]!,
            detail: `Échéance le ${jourDate(e.echeance)}/${e.echeance.slice(0, 4)} · ${e.jours < 0 ? `dépassée depuis ${-e.jours} j` : e.jours === 0 ? "aujourd'hui" : `dans ${e.jours} j`}`,
            echeance: e.echeance,
            critique: e.palier <= 7,
            ecran: "flotte.vehicules",
            href: `${urlDe("flotte.vehicule_fiche", { id: e.vehicleId! })}#papiers`,
          })),
        };
      },
    },
    {
      // Amendes à payer au tarif minoré avant leur date limite (30 jours ou moins). Hors périmètre d'un manager, comme les amendes à attribuer.
      type: "echeance_vehicule",
      nom: "échéances des amendes",
      ecran: "flotte.amendes",
      lire: async () => {
        if (appUser.role === "manager") return { brutes: [] };
        const echeances = echeancesSouhaitees([], await lireAmendesAEcheance(supabase, org), aujourdhui).slice(0, PLAFOND_PAR_SOURCE);
        return {
          plafonne: echeances.length >= PLAFOND_PAR_SOURCE,
          brutes: echeances.map((e) => ({
            type: "echeance_vehicule" as const,
            id: e.cle,
            libelle: e.message.split(" : ")[0]!,
            detail: `Tarif minoré jusqu'au ${jourDate(e.echeance)}/${e.echeance.slice(0, 4)} · ${e.jours < 0 ? `dépassé depuis ${-e.jours} j` : e.jours === 0 ? "aujourd'hui" : `dans ${e.jours} j`}`,
            echeance: e.echeance,
            critique: e.palier <= 7,
            ecran: "flotte.amendes",
            href: `${urlDe("flotte.amendes")}?amende=${e.relatedId}`,
          })),
        };
      },
    },
    {
      // Bulletins de paie en attente de la direction, un élément par mois.
      type: "bulletin_paie",
      nom: "bulletins de paie",
      ecran: "equipe.paie",
      lire: async () => {
        const rows = await lire<any>(supabase.from("payslips").select("period_start, validation_status").eq("validation_status", "en_attente").limit(2000));
        const moisCourant = aujourdhui.slice(0, 7);
        return {
          brutes: bulletinsAValiderParMois(rows).map((b) => ({
            type: "bulletin_paie" as const,
            id: b.mois,
            libelle: `Bulletins de paie à valider · ${b.mois.slice(5, 7)}/${b.mois.slice(0, 4)}`,
            detail: `${b.nombre} bulletin${b.nombre > 1 ? "s" : ""} en attente de la direction`,
            // Un mois passé qui attend encore est urgent.
            critique: b.mois < moisCourant,
            ecran: "equipe.paie",
            href: urlDe("equipe.paie") + suiteMoisPaie(b.mois, moisCourant),
          })),
        };
      },
    },
    {
      // Congés à valider.
      type: "conge",
      nom: "congés",
      ecran: "equipe.conges",
      lire: async () => {
        const rows = await lire<any>(
          supabase.from("leave_requests").select("id, driver_id, start_date, end_date, created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(PLAFOND_PAR_SOURCE),
        );
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((c) => ({
            type: "conge" as const,
            id: c.id,
            libelle: "Congé · {nom}",
            detail: `du ${jourDate(c.start_date)} au ${jourDate(c.end_date)}`,
            depuis: c.created_at,
            echeance: c.start_date,
            ecran: "equipe.conges",
            href: urlDe("equipe.conges"),
            auteurId: c.driver_id,
            personneId: c.driver_id,
            groupable: true,
          })),
        };
      },
    },
    {
      // Arrêts de travail déclarés (reçus), à valider ou refuser. Le motif médical n'est jamais affiché.
      type: "arret",
      nom: "arrêts de travail",
      ecran: "equipe.arrets",
      lire: async () => {
        const rows = await lire<any>(
          supabase.from("work_stoppages").select("id, user_id, start_date, end_date, created_at").eq("status", "recu").order("created_at", { ascending: true }).limit(PLAFOND_PAR_SOURCE),
        );
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((a) => ({
            type: "arret" as const,
            id: a.id,
            libelle: "Arrêt de travail · {nom}",
            detail: `du ${jourDate(a.start_date)} au ${jourDate(a.end_date)}`,
            depuis: a.created_at,
            ecran: "equipe.arrets",
            href: urlDe("equipe.arrets"),
            auteurId: a.user_id,
            personneId: a.user_id,
            paie: true,
            groupable: true,
          })),
        };
      },
    },
    {
      // Sorties oubliées : pointages clos la nuit avec une heure estimée, à corriger (motif obligatoire). Lecture sous la RLS du pointage (manager : son service).
      type: "pointage_a_regulariser",
      nom: "pointages à régulariser",
      ecran: "equipe.pointage",
      lire: async () => {
        const rows = await lire<any>(
          supabase.from("time_clock_entries").select("id, user_id, clocked_in_at, clocked_out_at, estimated_out_source").eq("organization_id", org).eq("needs_regularization", true).order("clocked_in_at", { ascending: true }).limit(PLAFOND_PAR_SOURCE),
        );
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((p) => ({
            type: "pointage_a_regulariser" as const,
            id: p.id,
            libelle: "Pointage à régulariser · {nom}",
            detail: `Entrée le ${jourCourt(p.clocked_in_at)} à ${heure(p.clocked_in_at)} · ${p.estimated_out_source === "a_saisir" ? "sortie à saisir" : `sortie estimée à ${heure(p.clocked_out_at)}`}`,
            depuis: p.clocked_in_at,
            ecran: "equipe.pointage",
            href: urlDe("equipe.pointage"),
            // Hiérarchie : on ne régularise pas son propre pointage (direction seule : tracé).
            auteurId: p.user_id,
            personneId: p.user_id,
          })),
        };
      },
    },
    {
      // Repos quotidien, amplitude, durée hebdomadaire, jours consécutifs (7 derniers jours) : avertissements non bloquants, à valider avec l'expert paie.
      type: "repos_conduite",
      nom: "repos et durée du travail",
      ecran: "equipe.pointage",
      lire: async () => {
        const regles = reglesTempsTravail((await paysOrganisation(supabase, org)).code);
        if (!regles) return { brutes: [] };
        const depuis = new Date(maintenant.getTime() - 14 * 86_400_000).toISOString();
        const rows = await lire<any>(supabase.from("time_clock_entries").select("user_id, clocked_in_at, clocked_out_at").eq("organization_id", org).gte("clocked_in_at", depuis).order("clocked_in_at").limit(5000));
        const parSalarie = new Map<string, { entree: string; sortie: string | null }[]>();
        for (const r of rows) parSalarie.set(r.user_id, [...(parSalarie.get(r.user_id) ?? []), { entree: r.clocked_in_at, sortie: r.clocked_out_at }]);
        const limite = addDays(aujourdhui, -7);
        const brutes: ElementBrut[] = [];
        for (const [userId, pointages] of parSalarie) {
          const avertissements = controlerTempsTravail(joursDepuisPointages(pointages), regles).filter((a) => a.jour >= limite);
          if (avertissements.length === 0) continue;
          const dernier = avertissements[avertissements.length - 1]!;
          const codes = [...new Set(avertissements.map((a) => a.code))];
          brutes.push({
            type: "repos_conduite",
            id: `${userId}:${dernier.jour}:${codes.join("+")}`,
            libelle: "Repos ou durée du travail à vérifier · {nom}",
            detail: `${codes.map((c) => LIBELLE_CONTROLE_REPOS[c]).join(", ")} · ${court(dernier.message, 120)} (${MENTION_A_VALIDER})`,
            depuis: `${dernier.jour}T12:00:00Z`,
            ecran: "equipe.pointage",
            href: urlDe("equipe.pointage"),
            personneId: userId,
          });
        }
        return { plafonne: brutes.length >= PLAFOND_PAR_SOURCE, brutes: brutes.slice(0, PLAFOND_PAR_SOURCE) };
      },
    },
    {
      // Permis, visite médicale, fin de contrat, documents datés : alertes du cron RH (lues sous la RLS : un manager ne voit que les genres non sensibles de son service).
      // Aucune donnée médicale : seulement « visite médicale à renouveler ».
      type: "echeance_rh",
      nom: "échéances RH",
      ecran: "equipe.utilisateur_fiche",
      lire: async () => {
        const { data, error } = await supabase
          .from("alerts")
          .select("id, severity, message, related_id, created_at, cle_dedoublonnage")
          .eq("organization_id", org)
          .eq("type", "echeance_rh")
          .in("status", ["open", "acknowledged"])
          .order("created_at", { ascending: true })
          .limit(PLAFOND_PAR_SOURCE);
        // Type d'alerte ou colonne absents (migrations 20261109000001/2 pas appliquées) : rien à lister.
        if (error) {
          if (estSchemaManquant(error) || estValeurEnumInconnue(error)) return { brutes: [] };
          throw new Error(error.message);
        }
        const rows = (data ?? []) as { id: string; severity: string; message: string; related_id: string | null; created_at: string; cle_dedoublonnage: string | null }[];
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows
            .filter((a) => a.related_id)
            .map((a) => {
              const [libelle, ...reste] = a.message.split(" : ");
              // Clé : rh:<genre>:<objet>:<AAAA-MM-JJ>:<palier>.
              const echeance = a.cle_dedoublonnage?.split(":")[3] ?? null;
              return {
                type: "echeance_rh" as const,
                id: a.id,
                libelle: libelle!,
                detail: reste.length ? court(reste.join(" : "), 140) : null,
                depuis: a.created_at,
                echeance,
                critique: a.severity !== "info",
                ecran: "equipe.utilisateur_fiche",
                href: urlDe("equipe.utilisateur_fiche", { id: a.related_id! }),
              };
            }),
        };
      },
    },
    {
      // Contestations clients : responsable à valider, ou réponse du chauffeur à clôturer.
      type: "contestation",
      nom: "contestations",
      ecran: "exploitation.contestations",
      lire: async () => {
        const rows = await lire<any>(
          supabase
            .from("customer_disputes")
            .select("id, status, client_name, reference, created_at, driver_id, suggested_driver_id")
            .in("status", ["to_validate", "answered"])
            .order("created_at", { ascending: true })
            .limit(PLAFOND_PAR_SOURCE),
        );
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((c) => {
            const avalider = c.status === "to_validate";
            return {
              type: "contestation" as const,
              id: c.id,
              libelle: avalider ? "Contestation : responsable à valider" : "Contestation : réponse du chauffeur à clôturer",
              detail: court([c.client_name, c.reference].filter(Boolean).join(" · ")) || null,
              depuis: c.created_at,
              ecran: "exploitation.contestations",
              href: urlDe("exploitation.contestations"),
              auteurId: (avalider ? (c.suggested_driver_id ?? c.driver_id) : c.driver_id) ?? null,
              choixLibre: avalider,
            };
          }),
        };
      },
    },
    {
      // Chauffeurs inscrits par le lien d'invitation, en attente d'approbation.
      type: "inscription",
      nom: "inscriptions",
      ecran: "equipe.inscriptions",
      lire: async () => {
        const rows = await lire<any>(
          supabase.from("users").select("id, full_name, created_at").eq("organization_id", org).eq("pending_approval", true).order("created_at", { ascending: true }).limit(PLAFOND_PAR_SOURCE),
        );
        return {
          plafonne: rows.length >= PLAFOND_PAR_SOURCE,
          brutes: rows.map((u) => ({
            type: "inscription" as const,
            id: u.id,
            libelle: `Inscription à valider · ${u.full_name}`,
            depuis: u.created_at,
            ecran: "equipe.inscriptions",
            href: urlDe("equipe.inscriptions"),
          })),
        };
      },
    },
  ];
  const sources = toutes.filter((s) => ecranOuvrable(s.ecran, ctx) && typeVisiblePour(s.type, appUser.role));

  const erreurs: string[] = [];
  const plafonnes = new Set<TypeATraiter>();
  const lectures = await Promise.all(
    sources.map(async (s): Promise<ElementBrut[]> => {
      try {
        const l = await avecDelai(s.lire(), delai);
        if (l.plafonne) plafonnes.add(s.type);
        return l.brutes;
      } catch (e) {
        if (!(e instanceof DelaiDepasse)) console.error("à traiter :", s.nom, e instanceof Error ? e.message : e);
        erreurs.push(s.nom);
        return [];
      }
    }),
  );
  const brutes = lectures.flat();

  // Une seule lecture des personnes citées : rôle (hiérarchie) et nom.
  const ids = [...new Set(brutes.flatMap((b) => [b.auteurId, b.personneId]).filter((x): x is string => Boolean(x)))];
  const personnes = new Map<string, PersonneConnue>();
  if (ids.length > 0) {
    try {
      const pages = await Promise.all(lots(ids, LOT_REQUETE).map((l) => lire<any>(supabase.from("users").select("id, role, full_name").eq("organization_id", org).in("id", l))));
      for (const u of pages.flat()) personnes.set(u.id, { role: u.role, nom: u.full_name ?? null });
    } catch (e) {
      console.error("à traiter : personnes", e instanceof Error ? e.message : e);
    }
  }
  const direction = appUser.role === "direction" || [...personnes.values()].some((p) => p.role === "direction");
  const directionCount = direction ? await compterDirection(supabase, org) : 2;

  const liste = construireListe({ brutes, moi: { id: appUser.id, role: appUser.role }, personnes, directionCount, maintenant });
  return { ...liste, erreurs: [...new Set(erreurs)], plafonnes: [...plafonnes] };
}
