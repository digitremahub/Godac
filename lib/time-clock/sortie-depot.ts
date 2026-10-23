import { dateParis } from "@/lib/colis/heure-paris";

/**
 * Sortie du dépôt pointée automatiquement : logique pure (aucun accès
 * base), testée dans __tests__/sortie-depot.test.ts. La route
 * app/api/time-clock/assisted n'y ajoute que les lectures/écritures.
 *
 * Principe de paie : l'heure de sortie n'est JAMAIS « maintenant » ni
 * une heure déduite — c'est la dernière fois où le téléphone a été vu
 * au dépôt (time_clock_entries.last_depot_seen_at), et seulement si
 * cette présence est récente. Sinon on ne modifie rien : le chauffeur
 * choisit lui-même l'heure.
 */

/** Au-delà, la dernière présence au dépôt est trop ancienne pour pointer seule la sortie. */
export const FRAICHEUR_PRESENCE_MS = 30 * 60 * 1000;
/** Tolérance d'horloge entre le serveur et la base pour une présence « dans le futur ». */
const TOLERANCE_HORLOGE_MS = 60 * 1000;

export type DecisionSortie =
  | { action: "rien"; raison: "organisation_desactivee" | "pas_d_entree" | "tournee_en_cours" | "tournee_non_cloturee" | "position_imprecise" }
  | { action: "maj_presence" }
  | { action: "sortie_auto"; clockedOutAt: string }
  | { action: "offre"; lastSeenAt: string | null };

export interface EntreeDecision {
  /** Pointage assisté activé pour l'organisation (organizations.auto_clock_enabled). */
  organisationActive: boolean;
  /** Le salarié a une entrée de pointage ouverte. */
  entreeOuverte: boolean;
  /** Entrée ouverte : instant d'arrivée (ISO). */
  clockedInAt: string | null;
  /** Position précise (≤ MAX_ACCURACY_M) : sans cela on ne conclut ni « au dépôt » ni « hors dépôt ». */
  positionPrecise: boolean;
  /** depotMatch() non nul : dans le rayon d'un dépôt du salarié. */
  auDepot: boolean;
  /** Une tournée colis ou du planning est en cours pour ce salarié. */
  tourneeEnCours: boolean;
  /** Au moins une tournée clôturée depuis son arrivée. */
  tourneeCloturee: boolean;
  /** Dernière présence au dépôt mémorisée (ISO), si elle existe. */
  lastDepotSeenAt: string | null;
  maintenant: Date;
}

/** Présence mémorisée utilisable : valide, postérieure à l'arrivée, pas dans le futur. null sinon. */
export function presenceValide(lastDepotSeenAt: string | null, clockedInAt: string | null, maintenant: Date): Date | null {
  if (!lastDepotSeenAt) return null;
  const vue = new Date(lastDepotSeenAt);
  if (Number.isNaN(vue.getTime())) return null;
  if (vue.getTime() > maintenant.getTime() + TOLERANCE_HORLOGE_MS) return null;
  if (clockedInAt) {
    const arrivee = new Date(clockedInAt);
    if (!Number.isNaN(arrivee.getTime()) && vue.getTime() < arrivee.getTime()) return null;
  }
  return vue;
}

/** Présence mémorisée assez récente pour servir d'heure de sortie automatique. */
export function presenceFraiche(vue: Date, maintenant: Date): boolean {
  const age = maintenant.getTime() - vue.getTime();
  return age <= FRAICHEUR_PRESENCE_MS;
}

/**
 * Que faire d'une position reçue ?
 * - au dépôt (entrée ouverte) → mémoriser la présence ;
 * - précise, hors dépôt, plus de tournée en cours, une tournée clôturée,
 *   présence récente (< 30 min) → sortie automatique à l'heure de la
 *   dernière présence ;
 * - mêmes conditions mais présence absente ou ancienne → simple offre,
 *   rien n'est modifié ;
 * - tout le reste → rien.
 */
export function decider(e: EntreeDecision): DecisionSortie {
  if (!e.organisationActive) return { action: "rien", raison: "organisation_desactivee" };
  if (!e.entreeOuverte) return { action: "rien", raison: "pas_d_entree" };
  if (!e.positionPrecise) return { action: "rien", raison: "position_imprecise" };
  if (e.auDepot) return { action: "maj_presence" };
  if (e.tourneeEnCours) return { action: "rien", raison: "tournee_en_cours" };
  if (!e.tourneeCloturee) return { action: "rien", raison: "tournee_non_cloturee" };

  const vue = presenceValide(e.lastDepotSeenAt, e.clockedInAt, e.maintenant);
  if (vue && presenceFraiche(vue, e.maintenant)) {
    return { action: "sortie_auto", clockedOutAt: vue.toISOString() };
  }
  return { action: "offre", lastSeenAt: vue ? vue.toISOString() : null };
}

/**
 * Une tournée a-t-elle été clôturée depuis l'arrivée du salarié ?
 * - tournées colis (delivery_runs) : seule la date (run_date) existe ;
 *   on compare au jour d'arrivée à Paris ;
 * - tournées du planning : end_at (instant de clôture) ≥ arrivée.
 */
export function tourneeClotureeDepuisArrivee(params: {
  clockedInAt: string;
  runsClotures: { run_date: string }[];
  planningCloture: { end_at: string | null }[];
}): boolean {
  const arrivee = new Date(params.clockedInAt);
  if (Number.isNaN(arrivee.getTime())) return false;
  const jourArrivee = dateParis(arrivee);
  if (params.runsClotures.some((r) => r.run_date >= jourArrivee)) return true;
  return params.planningCloture.some((p) => {
    if (!p.end_at) return false;
    const fin = new Date(p.end_at).getTime();
    return !Number.isNaN(fin) && fin >= arrivee.getTime();
  });
}

/**
 * Délai pour annuler une sortie automatique (mesuré depuis l'heure de
 * sortie enregistrée). Au-delà, une entrée ré-ouverte plus tard serait
 * refermée « maintenant » par la bascule manuelle et fabriquerait des
 * heures : la direction corrige alors le pointage.
 */
export const DELAI_ANNULATION_SORTIE_MS = 2 * 60 * 60 * 1000;

/**
 * Annulation d'une sortie automatique : uniquement si elle a bien été
 * pointée automatiquement, récemment, si elle est toujours la dernière
 * entrée du salarié (sinon une entrée plus récente existe déjà — ré-ouvrir
 * créerait deux entrées) et si aucune autre entrée n'est ouverte. Renvoie
 * le message de refus, ou null si l'annulation est possible.
 */
export function refusAnnulationSortie(
  entree: { id: string; user_id: string; auto_clocked_out: boolean | null; clocked_out_at: string | null },
  demandeur: string,
  derniereEntreeId: string | null,
  uneEntreeOuverte: boolean,
  maintenant: Date,
): string | null {
  if (entree.user_id !== demandeur) return "Ce pointage est introuvable.";
  if (!entree.auto_clocked_out || !entree.clocked_out_at) return "Cette sortie n'a pas été pointée automatiquement : elle ne peut pas être annulée ici.";
  if (maintenant.getTime() - new Date(entree.clocked_out_at).getTime() > DELAI_ANNULATION_SORTIE_MS) {
    return "Cette sortie automatique date de plus de 2 heures : contactez votre responsable pour la corriger.";
  }
  if (derniereEntreeId !== entree.id) return "Un pointage plus récent existe : cette sortie ne peut plus être annulée.";
  if (uneEntreeOuverte) return "Vous êtes déjà pointé : cette sortie ne peut plus être annulée.";
  return null;
}

/**
 * Sortie choisie par le salarié « à ma dernière présence au dépôt »
 * (proposition quand la sortie n'a pas pu être pointée seule). L'heure
 * vient TOUJOURS de la base, jamais du client. Renvoie l'instant, ou un
 * message de refus.
 */
export function heureSortieDernierePresence(params: {
  lastDepotSeenAt: string | null;
  clockedInAt: string;
  maintenant: Date;
}): { ok: true; at: string } | { ok: false; error: string } {
  const vue = presenceValide(params.lastDepotSeenAt, params.clockedInAt, params.maintenant);
  if (!vue) return { ok: false, error: "Aucune présence au dépôt n'est enregistrée depuis votre arrivée : pointez la sortie maintenant." };
  return { ok: true, at: vue.toISOString() };
}
