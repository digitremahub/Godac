/**
 * Tournée du planning ouverte / fermée (logique pure, testée dans
 * __tests__/ouverture.test.ts).
 *
 * `planning_entries.tour_open` (migration 20261105000001) : une tournée
 * fermée n'accepte plus de changement d'affectation et ne peut plus être
 * démarrée par le chauffeur ; la rouvrir rétablit tout. Fermer ne supprime
 * rien, pas même la fiche Tournée colis liée.
 *
 * Sans la migration, la colonne n'existe pas : toute tournée est ouverte.
 */

export type FiltreOuverture = "toutes" | "ouvertes" | "fermees";

export const FILTRES_OUVERTURE: readonly { valeur: FiltreOuverture; libelle: string }[] = [
  { valeur: "toutes", libelle: "Toutes" },
  { valeur: "ouvertes", libelle: "Ouvertes" },
  { valeur: "fermees", libelle: "Fermées" },
];

export interface EntreeOuverture {
  tour_open?: boolean | null;
}

/** Ouverte, sauf si la base dit explicitement le contraire (colonne absente ou vide = ouverte). */
export const estOuverte = (e: EntreeOuverture): boolean => e.tour_open !== false;

/**
 * Tournée FERMÉE SANS CHAUFFEUR (« non affectée ») : l'exploitation sait
 * qu'elle ne roule pas ce jour-là (férié, pas de volume, tournée supprimée).
 * C'est une ligne planning_entries sans driver_id avec tour_open = false :
 * elle ne compte plus comme « à pourvoir » (couverture, « À traiter »,
 * alertes) et ne peut plus être affectée tant qu'on ne la rouvre pas.
 */
export const estFermeeNonAffectee = (e: EntreeOuverture & { driver_id?: string | null }): boolean => !estOuverte(e) && !e.driver_id;

/** Rôles qui ouvrent / ferment une tournée (la direction et l'exploitation partout, le manager sur son service). */
export const ROLES_OUVERTURE = ["direction", "exploitation", "manager", "manager_chauffeur"] as const;

export type VerdictOuverture = { ok: true; autoValidee?: boolean } | { ok: false; raison: string };

/**
 * Cette personne peut-elle fermer ou rouvrir cette tournée ?
 * - direction et exploitation : toutes les tournées de l'organisation ;
 * - manager : seulement celles de son service ;
 * - personne ne ferme ni ne rouvre SA PROPRE tournée (même règle que les
 *   demandes, lib/hierarchie/demandes.ts), sauf une direction seule dans
 *   l'organisation (auto-validation, tracée par l'appelant) ;
 * - une tournée terminée ou annulée n'a plus d'ouverture à changer.
 */
export function peutChangerOuverture(p: {
  role: string;
  userId: string;
  serviceIds: readonly string[];
  entree: { service_id: string; driver_id: string | null; status: string };
  /** Comptes direction actifs de l'organisation (1 : la direction n'est jamais bloquée). */
  directionCount: number;
}): VerdictOuverture {
  const { role, userId, serviceIds, entree } = p;
  if (!(ROLES_OUVERTURE as readonly string[]).includes(role)) {
    return { ok: false, raison: "Seule la direction, l'exploitation ou le chef d'équipe du service peut ouvrir ou fermer une tournée." };
  }
  if (entree.status === "done" || entree.status === "cancelled") {
    return { ok: false, raison: `Tournée ${entree.status === "done" ? "terminée" : "annulée"} : son ouverture ne change plus.` };
  }
  if ((role === "manager" || role === "manager_chauffeur") && !serviceIds.includes(entree.service_id)) {
    return { ok: false, raison: "Un chef d'équipe n'ouvre ni ne ferme que les tournées de son service." };
  }
  if (entree.driver_id === userId) {
    if (role === "direction" && p.directionCount <= 1) return { ok: true, autoValidee: true };
    return { ok: false, raison: "Vous ne pouvez pas fermer ni rouvrir votre propre tournée : demandez à l'exploitation ou à la direction." };
  }
  return { ok: true };
}

/**
 * Cette personne peut-elle fermer ou rouvrir une tournée NON AFFECTÉE d'un
 * service ? Même périmètre que l'ouverture d'une affectation : direction et
 * exploitation partout, manager sur son service, personne d'autre. Pas de
 * règle « sa propre tournée » : il n'y a pas de chauffeur.
 */
export function peutFermerNonAffectee(p: { role: string; serviceIds: readonly string[]; serviceId: string }): VerdictOuverture {
  if (!(ROLES_OUVERTURE as readonly string[]).includes(p.role)) {
    return { ok: false, raison: "Seule la direction, l'exploitation ou le chef d'équipe du service peut fermer ou rouvrir une tournée." };
  }
  if ((p.role === "manager" || p.role === "manager_chauffeur") && !p.serviceIds.includes(p.serviceId)) {
    return { ok: false, raison: "Un chef d'équipe ne ferme ni ne rouvre que les tournées de son service." };
  }
  return { ok: true };
}

/**
 * « Tournée fermée par Marie D. le 26/10 à 14:05. … » : au chauffeur qui veut
 * démarrer (il contacte l'exploitation), à l'encadrement qui veut modifier
 * l'affectation (il rouvre d'abord).
 */
export function messageTourneeFermee(par: string | null | undefined, le?: string | null, pour: "chauffeur" | "encadrement" = "chauffeur"): string {
  const qui = par?.trim() ? ` par ${par.trim()}` : "";
  const quand = le ? formaterQuand(le) : "";
  const suite = pour === "chauffeur" ? "Contactez l'exploitation pour la faire rouvrir." : "Rouvrez-la pour modifier son affectation.";
  return `Tournée fermée${qui}${quand ? ` ${quand}` : ""}. ${suite}`;
}

function formaterQuand(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const jour = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" }).format(d);
  const heure = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `le ${jour} à ${heure}`;
}

/** « Fermée par Marie D. le 26/10 à 14:05 » (infobulle et lecteur d'écran de la pastille). */
export function libelleFermeture(par: string | null | undefined, le?: string | null): string {
  const qui = par?.trim() ? ` par ${par.trim()}` : "";
  const quand = le ? formaterQuand(le) : "";
  return `Fermée${qui}${quand ? ` ${quand}` : ""}`;
}

/**
 * Texte de confirmation avant de fermer une tournée dont la fiche Tournée
 * colis liée est en cours (delivery_runs.status = 'in_progress'), sinon null.
 * Fermer ne supprime rien : la fiche reste telle quelle.
 */
export function confirmationFermeture(fichesEnCours: number): string | null {
  if (fichesEnCours <= 0) return null;
  return fichesEnCours === 1
    ? "La tournée colis liée est en cours. Fermer la tournée du planning ne la supprime pas et ne l'interrompt pas, mais plus personne ne pourra changer son affectation. Fermer quand même ?"
    : `${fichesEnCours} tournées colis liées sont en cours. Fermer la tournée du planning ne les supprime pas et ne les interrompt pas, mais plus personne ne pourra changer son affectation. Fermer quand même ?`;
}

/** Filtre Ouvertes / Fermées / Toutes d'une liste d'affectations. */
export function filtrerParOuverture<T extends EntreeOuverture>(entrees: readonly T[], filtre: FiltreOuverture): T[] {
  if (filtre === "toutes") return [...entrees];
  return entrees.filter((e) => (filtre === "fermees" ? !estOuverte(e) : estOuverte(e)));
}

/**
 * Une tournée (une ligne, une carte) est-elle montrée par ce filtre ? Ses
 * affectations décident ; sans aucune affectation, la tournée est « ouverte »
 * (rien n'a été fermé).
 */
export function ligneCorrespond(filtre: FiltreOuverture, entrees: readonly EntreeOuverture[]): boolean {
  if (filtre === "toutes") return true;
  if (filtre === "fermees") return entrees.some((e) => !estOuverte(e));
  return entrees.length === 0 || entrees.some(estOuverte);
}

export function compterFermees(entrees: readonly (EntreeOuverture & { status?: string })[]): number {
  return entrees.filter((e) => !estOuverte(e) && e.status !== "cancelled").length;
}

export const ACTION_OUVERTURE = { fermer: "Fermer", rouvrir: "Rouvrir" } as const;
