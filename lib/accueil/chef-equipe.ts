// Accueil du manager (chef d'équipe) : logique pure, sans dépendance
// serveur, testée dans lib/accueil/__tests__/chef-equipe.test.ts.
//
// Un manager observe EN UN COUP D'ŒIL son équipe, les véhicules de ses
// services, les amendes et contestations ouvertes et ses notifications.
// Aucune donnée de paie ni de salaire n'entre ici.

import { droitsDecision, type PersonneHierarchie } from "@/lib/hierarchie/demandes";
import { arretActif } from "@/lib/arrets/declaration";
import { expiryStatus } from "@/lib/vehicles/document-types";

// ── Équipe ──────────────────────────────────────────────────────────

export type EtatMembre = "en_tournee" | "disponible" | "conge" | "arret" | "non_planifie";

export const LIBELLE_ETAT_MEMBRE: Record<EtatMembre, string> = {
  en_tournee: "En tournée",
  disponible: "Disponible",
  conge: "En congé",
  arret: "Arrêt de travail",
  non_planifie: "Non planifié",
};

/** Ordre d'affichage : ceux qui roulent d'abord, les absents ensuite. */
const ORDRE_ETAT: Record<EtatMembre, number> = { en_tournee: 0, disponible: 1, non_planifie: 2, conge: 3, arret: 4 };

export interface EntreePlanningJour {
  driver_id: string | null;
  vehicle_id?: string | null;
  tour_number?: string | null;
  /** planned | in_progress | completed | presence | cancelled… */
  status: string;
  start_at?: string | null;
  vehicles?: { registration: string } | null;
}

export interface EtatEntree {
  /** Une tournée démarrée et non terminée. */
  enTournee: boolean;
  /** Congé approuvé qui couvre aujourd'hui. */
  enConge: boolean;
  /** Arrêt de travail (non refusé) qui couvre aujourd'hui. */
  enArret: boolean;
  /** Une affectation du jour (prévue, terminée ou présence), hors annulée. */
  planifie: boolean;
}

/**
 * État du jour d'un membre. Priorité : arrêt de travail, congé, tournée en
 * cours, puis « disponible » (planifié aujourd'hui sans tournée en cours),
 * sinon « non planifié ». Un congé ou un arrêt l'emporte sur le planning
 * (une affectation oubliée ne rend pas la personne disponible).
 */
export function etatMembre(e: EtatEntree): EtatMembre {
  if (e.enArret) return "arret";
  if (e.enConge) return "conge";
  if (e.enTournee) return "en_tournee";
  if (e.planifie) return "disponible";
  return "non_planifie";
}

export interface MembreBrut {
  id: string;
  full_name: string;
  role: string;
  can_drive?: boolean | null;
  /** Services du membre (pour la hiérarchie). */
  serviceIds?: string[];
}

export interface CongeJour {
  driver_id: string;
  start_date: string;
  end_date: string;
  status?: string | null;
}

export interface ArretJour {
  userId: string;
  du: string;
  au: string;
  statut?: string | null;
}

export interface MembreEquipe {
  id: string;
  nom: string;
  role: string;
  serviceIds: string[];
  etat: EtatMembre;
  /** Tournée du jour (numéro), si en tournée ou planifié. */
  tournee: string | null;
  /** Véhicule de la tournée en cours. */
  immatriculation: string | null;
}

const couvre = (du: string, au: string, jour: string) => du.slice(0, 10) <= jour && au.slice(0, 10) >= jour;

/**
 * Assemble l'équipe du jour. `entrees` : affectations du jour et tournées en
 * cours (doublons tolérés). Un membre peut apparaître une seule fois.
 * Les congés non approuvés et les arrêts refusés ne comptent pas.
 */
export function construireEquipe(p: {
  membres: readonly MembreBrut[];
  entrees: readonly EntreePlanningJour[];
  conges: readonly CongeJour[];
  arrets: readonly ArretJour[];
  jour: string;
}): MembreEquipe[] {
  const entreesParMembre = new Map<string, EntreePlanningJour[]>();
  for (const e of p.entrees) {
    if (!e.driver_id || e.status === "cancelled") continue;
    entreesParMembre.set(e.driver_id, [...(entreesParMembre.get(e.driver_id) ?? []), e]);
  }
  const enConge = new Set(p.conges.filter((c) => c.status === undefined || c.status === null || c.status === "approved").filter((c) => couvre(c.start_date, c.end_date, p.jour)).map((c) => c.driver_id));
  const enArret = new Set(p.arrets.filter((a) => arretActif({ statut: a.statut })).filter((a) => couvre(a.du, a.au, p.jour)).map((a) => a.userId));

  const vus = new Set<string>();
  const equipe: MembreEquipe[] = [];
  for (const m of p.membres) {
    if (vus.has(m.id)) continue;
    vus.add(m.id);
    const siennes = entreesParMembre.get(m.id) ?? [];
    const enCours = siennes.find((e) => e.status === "in_progress");
    const reference = enCours ?? siennes[0] ?? null;
    equipe.push({
      id: m.id,
      nom: m.full_name,
      role: m.role,
      serviceIds: m.serviceIds ?? [],
      etat: etatMembre({ enTournee: Boolean(enCours), enConge: enConge.has(m.id), enArret: enArret.has(m.id), planifie: siennes.length > 0 }),
      tournee: reference?.tour_number && !reference.tour_number.startsWith("PRESENCE-") ? reference.tour_number : null,
      immatriculation: enCours?.vehicles?.registration ?? null,
    });
  }
  return equipe.sort((a, b) => ORDRE_ETAT[a.etat] - ORDRE_ETAT[b.etat] || a.nom.localeCompare(b.nom, "fr"));
}

export interface CompteursEquipe {
  total: number;
  enTournee: number;
  disponibles: number;
  /** Congés et arrêts de travail. */
  absents: number;
  nonPlanifies: number;
}

export function compterEquipe(equipe: readonly Pick<MembreEquipe, "etat">[]): CompteursEquipe {
  const c: CompteursEquipe = { total: equipe.length, enTournee: 0, disponibles: 0, absents: 0, nonPlanifies: 0 };
  for (const m of equipe) {
    if (m.etat === "en_tournee") c.enTournee++;
    else if (m.etat === "disponible") c.disponibles++;
    else if (m.etat === "conge" || m.etat === "arret") c.absents++;
    else c.nonPlanifies++;
  }
  return c;
}

/** « 3 en tournée · 5 disponibles · 1 absent » (les non planifiés en fin si présents). */
export function resumeEquipe(c: CompteursEquipe): string {
  const pl = (n: number, s: string, p = `${s}s`) => `${n} ${n > 1 ? p : s}`;
  const parts = [`${c.enTournee} en tournée`, pl(c.disponibles, "disponible"), pl(c.absents, "absent")];
  if (c.nonPlanifies > 0) parts.push(pl(c.nonPlanifies, "non planifié"));
  return parts.join(" · ");
}

// ── Véhicules ───────────────────────────────────────────────────────

export type EtatVehicule = "en_tournee" | "disponible" | "entretien" | "hors_service";

export const LIBELLE_ETAT_VEHICULE: Record<EtatVehicule, string> = {
  en_tournee: "En tournée",
  disponible: "Disponible",
  entretien: "Entretien en cours",
  hors_service: "Hors service",
};

export interface VehiculeBrut {
  id: string;
  registration: string;
  type?: string | null;
  /** active | maintenance | out_of_service */
  status: string;
}

export interface DocumentVehicule {
  vehicle_id: string;
  doc_type: string;
  expires_on: string | null;
}

export interface VehiculeService {
  id: string;
  immatriculation: string;
  type: string | null;
  etat: EtatVehicule;
  /** Chauffeur de la tournée en cours. */
  chauffeur: string | null;
  /** Un document ou contrôle expire bientôt (ou est expiré). */
  asurveiller: boolean;
  /** Précision : « Contrôle technique expiré », « Attestation d'assurance sous 30 jours »… */
  motif: string | null;
}

export interface TourneeEnCours {
  vehicle_id: string | null;
  chauffeur: string | null;
}

/** Libellé du motif de surveillance d'un document, ou null. */
export function motifSurveillance(doc: Pick<DocumentVehicule, "doc_type" | "expires_on">, aujourdhui: string): string | null {
  const s = expiryStatus(doc.expires_on, aujourdhui);
  if (s === "expired") return `${doc.doc_type} expiré`;
  if (s === "soon") return `${doc.doc_type} à renouveler sous 30 jours`;
  return null;
}

/**
 * État de chaque véhicule du service. Priorité : hors service, entretien en
 * cours (statut « maintenance » ou intervention démarrée), en tournée avec son
 * chauffeur, sinon disponible. « À surveiller » s'ajoute quel que soit l'état
 * quand un document expire (seulement si des dates d'échéance existent).
 */
export function construireVehicules(p: {
  vehicules: readonly VehiculeBrut[];
  tournees: readonly TourneeEnCours[];
  vehiculesEnIntervention: ReadonlySet<string>;
  documents: readonly DocumentVehicule[];
  aujourdhui: string;
}): VehiculeService[] {
  const parVehicule = new Map<string, string | null>();
  for (const t of p.tournees) if (t.vehicle_id) parVehicule.set(t.vehicle_id, t.chauffeur);
  const motifs = new Map<string, string[]>();
  for (const d of p.documents) {
    const m = motifSurveillance(d, p.aujourdhui);
    if (m) motifs.set(d.vehicle_id, [...(motifs.get(d.vehicle_id) ?? []), m]);
  }
  const liste = p.vehicules.map((v): VehiculeService => {
    let etat: EtatVehicule = "disponible";
    if (v.status === "out_of_service") etat = "hors_service";
    else if (v.status === "maintenance" || p.vehiculesEnIntervention.has(v.id)) etat = "entretien";
    else if (parVehicule.has(v.id)) etat = "en_tournee";
    const m = motifs.get(v.id) ?? [];
    return {
      id: v.id,
      immatriculation: v.registration,
      type: v.type ?? null,
      etat,
      chauffeur: etat === "en_tournee" ? (parVehicule.get(v.id) ?? null) : null,
      asurveiller: m.length > 0,
      motif: m.length > 0 ? m.join(" · ") : null,
    };
  });
  const ordre: Record<EtatVehicule, number> = { en_tournee: 0, entretien: 1, hors_service: 2, disponible: 3 };
  return liste.sort((a, b) => Number(b.asurveiller) - Number(a.asurveiller) || ordre[a.etat] - ordre[b.etat] || a.immatriculation.localeCompare(b.immatriculation, "fr"));
}

export interface CompteursVehicules {
  total: number;
  enTournee: number;
  disponibles: number;
  entretien: number;
  asurveiller: number;
}

export function compterVehicules(vehicules: readonly Pick<VehiculeService, "etat" | "asurveiller">[]): CompteursVehicules {
  const c: CompteursVehicules = { total: vehicules.length, enTournee: 0, disponibles: 0, entretien: 0, asurveiller: 0 };
  for (const v of vehicules) {
    if (v.etat === "en_tournee") c.enTournee++;
    else if (v.etat === "disponible") c.disponibles++;
    else if (v.etat === "entretien") c.entretien++;
    if (v.asurveiller) c.asurveiller++;
  }
  return c;
}

// ── Amendes et contestations ────────────────────────────────────────

export const STATUTS_AMENDE_OUVERTE = ["pending_identification", "identified", "contested"] as const;
export const STATUTS_CONTESTATION_OUVERTE = ["to_validate", "assigned", "answered"] as const;

export const LIBELLE_STATUT_AMENDE: Record<string, string> = {
  pending_identification: "À traiter",
  identified: "Responsable désigné",
  contested: "Contestée",
};

export const LIBELLE_STATUT_CONTESTATION: Record<string, string> = {
  to_validate: "À valider",
  assigned: "Responsable notifié",
  answered: "Réponse reçue",
};

const JOUR_MS = 86_400_000;

/** Jours entiers écoulés depuis `iso` (0 si aujourd'hui ou dans le futur, null si date invalide). */
export function ancienneteJours(iso: string | null | undefined, maintenant: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((maintenant.getTime() - t) / JOUR_MS));
}

/** « aujourd'hui », « hier », « il y a 5 jours », « il y a 3 semaines », « il y a 2 mois ». */
export function libelleAnciennete(jours: number | null): string {
  if (jours === null) return "";
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return "hier";
  if (jours < 14) return `il y a ${jours} jours`;
  if (jours < 60) return `il y a ${Math.floor(jours / 7)} semaines`;
  return `il y a ${Math.floor(jours / 30)} mois`;
}

export interface DossierOuvert {
  id: string;
  /** Intitulé court (immatriculation de l'amende, client de la réclamation). */
  intitule: string;
  /** Statut brut (clé de LIBELLE_STATUT_*). */
  statut: string;
  /** Date de référence (infraction, réclamation). */
  date: string | null;
  /** Personne désignée (nom), si connue. */
  personne: string | null;
  /** Rôle de la personne désignée, pour la hiérarchie. */
  personneId: string | null;
  personneRole: string | null;
  personneServiceIds?: string[];
}

/** Du plus ancien au plus récent : ce qui traîne le plus passe en premier. */
export function trierParAnciennete<T extends { date: string | null }>(dossiers: readonly T[]): T[] {
  return [...dossiers].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
}

/** Fusionne des lectures qui se recoupent (même identifiant), la première gagne. */
export function fusionner<T extends { id: string }>(...listes: readonly (readonly T[])[]): T[] {
  const vus = new Set<string>();
  const out: T[] = [];
  for (const l of listes) {
    for (const x of l) {
      if (vus.has(x.id)) continue;
      vus.add(x.id);
      out.push(x);
    }
  }
  return out;
}

/**
 * Hiérarchie : le manager ne décide pas ce qui le concerne lui-même, ni ce
 * qui revient au niveau supérieur. Renvoie la mention à afficher (« Vous êtes
 * concerné — à décider par l'exploitation ou la direction ») ou null quand il
 * peut décider (ou qu'aucune personne n'est désignée).
 */
export function mentionHierarchie(p: { moi: PersonneHierarchie; dossier: Pick<DossierOuvert, "personneId" | "personneRole" | "personneServiceIds"> }): string | null {
  const { moi, dossier } = p;
  if (!dossier.personneId || !dossier.personneRole) return null;
  const d = droitsDecision({
    moi,
    demandeur: { id: dossier.personneId, role: dossier.personneRole, serviceIds: dossier.personneServiceIds },
    directionCount: 2,
  });
  if (d.peutDecider) return null;
  return d.mention;
}

/** Plafonne une liste à n éléments et dit s'il en reste. */
export function plafonner<T>(liste: readonly T[], n: number): { vus: T[]; reste: number } {
  return { vus: liste.slice(0, n), reste: Math.max(0, liste.length - n) };
}
