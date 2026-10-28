import { ACCUEIL_GO_NAVIGATION } from "@/lib/go-navigation/offre";
import { deciderAcces, ecran, horsOffreGoNavigation, urlDe } from "@/lib/acces/catalogue";
import type { UserRole } from "@/lib/types/domain";

/**
 * Lien d'une alerte : la page où le problème se traite. Partagé par le
 * centre de notifications (components/alerts/AlertList.tsx), la cloche
 * (app/api/notifications) et les e-mails et notifications push
 * (app/api/webhooks/supabase-alerts, une URL par rôle destinataire).
 *
 * Toutes les adresses viennent du catalogue (urlDe) : aucun lien ne passe
 * par une redirection. Quand le destinataire est connu et qu'il ne peut
 * pas ouvrir l'écran (rôle, conduite, module : deciderAcces), on prend
 * l'alternative prévue par le catalogue (ex. amendes → Mes amendes pour
 * un chauffeur), sinon le centre de notifications.
 */

/** Écran de traitement par table liée. */
const ECRAN_PAR_TABLE: Record<string, string> = {
  fuel_entries: "carburant.pleins",
  vehicle_interventions: "flotte.entretien",
  tank_deliveries: "carburant.approvisionnements",
  fines: "flotte.amendes",
  vehicles: "flotte.vehicules",
  customer_disputes: "exploitation.contestations",
  rental_maintenance_requests: "flotte.loueurs_demandes",
  planning_entries: "exploitation.historique",
  support_requests: "communication.assistance",
  meeting_requests: "communication.intranet",
  convocations: "communication.intranet",
  payslips: "equipe.paie",
  salary_advance_requests: "equipe.paie_acomptes",
  work_stoppages: "equipe.arrets",
};

type Cible = { id: string; params?: Record<string, string>; suite?: string } | { url: string };

/**
 * Surcharges par type d'alerte, avant la table liée. `relatedId` sert
 * aux liens vers une ligne précise (expéditeur d'un message, véhicule…).
 */
const CIBLE_PAR_TYPE: Record<string, (relatedId: string | null) => Cible> = {
  planning_validated: () => ({ id: "moi.planning" }),
  // Résumé de la semaine à venir : envoyé au chauffeur (alerte personnelle).
  weekly_planning_digest: () => ({ id: "moi.planning", suite: "?view=week" }),
  // Conflit d'affectation, changement de véhicule : le Planning, au jour de
  // la tournée concernée (?entry= : la page en déduit la date).
  planning_conflict: (id) => ({ id: "exploitation.planning", suite: id ? `?entry=${encodeURIComponent(id)}` : "" }),
  vehicle_swap: (id) => ({ id: "exploitation.planning", suite: id ? `?entry=${encodeURIComponent(id)}` : "" }),
  planning_assignment: (id) => ({ id: "moi.planning", suite: id ? `?entry=${encodeURIComponent(id)}` : "" }),
  new_message: (id) => ({ id: "communication.messenger", suite: id ? `?with=${encodeURIComponent(id)}` : "" }),
  // Groupe d'équipe du Messenger : related_id = message_groups.id.
  group_message: (id) => ({ id: "communication.messenger", suite: id ? `?groupe=${encodeURIComponent(id)}` : "" }),
  // Réponse à la question posée à l'assistant : elle s'affiche dans le
  // widget flottant (toutes les pages), ouvert par ?assistant=1.
  support_request_resolved: () => ({ url: "/dashboard?assistant=1" }),
  // Un chauffeur demande les papiers d'un véhicule : sa fiche, section papiers.
  vehicle_document_request: (id) => (id ? { id: "flotte.vehicule_fiche", params: { id }, suite: "#papiers" } : { id: "flotte.vehicules" }),
  // Fin de contrat / forfait km d'un véhicule loué : sa fiche.
  rental_contract: (id) => (id ? { id: "flotte.vehicule_fiche", params: { id }, suite: "#location" } : { id: "flotte.vehicules" }),
  // Bulletins en attente de validation : Paie du mois (direction).
  payslip_validation: () => ({ id: "equipe.paie" }),
  // Rappel TICPE (échéance de dépôt, ERA de janvier, réclamation qui expire) : tableau de bord TICPE.
  ticpe_rappel: () => ({ id: "carburant.ticpe" }),
  // Demande d'acompte : à traiter (direction, comptable ; un salarié est
  // renvoyé à ses demandes par l'alternative du catalogue).
  salary_advance: () => ({ id: "equipe.paie_acomptes" }),
  // Écart carburant (explication demandée au chauffeur, ou sa réponse) et
  // consommation anormale liée à un plein : le plein ouvert, fiche dépliée.
  fuel_gap_explanation: (id) => ({ id: "carburant.pleins", suite: id ? `?plein=${encodeURIComponent(id)}` : "" }),
  consumption_anomaly: (id) => ({ id: "carburant.pleins", suite: id ? `?plein=${encodeURIComponent(id)}` : "" }),
  // Bulletin validé par la direction : le salarié ouvre ses fiches de paie.
  payslip_available: () => ({ id: "moi.fiches_paie" }),
  // Amende (contestation ou explication du chauffeur) : la fiche, côté encadrement.
  fine_notification: (id) => ({ id: "flotte.amendes", suite: id ? `?amende=${encodeURIComponent(id)}` : "" }),
  // Contestation client : la fiche (le chauffeur attributaire ouvre la même page, limitée aux siennes).
  customer_dispute: (id) => ({ id: "exploitation.contestations", suite: id ? `?fiche=${encodeURIComponent(id)}` : "" }),
  // Tournée en retard (palier à surveiller / en retard) : le suivi en direct, tournée mise en avant.
  tournee_retard: (id) => ({ id: "exploitation.suivi", suite: id ? `?tournee=${encodeURIComponent(id)}` : "" }),
  // Tournée du planning non démarrée ou sans chauffeur (cron de surveillance) : la tournée ouverte dans le planning.
  tournee_non_demarree: (id) => ({ id: "exploitation.planning", suite: id ? `?entry=${encodeURIComponent(id)}` : "" }),
  tournee_sans_chauffeur: (id) => ({ id: "exploitation.planning", suite: id ? `?entry=${encodeURIComponent(id)}` : "" }),
  // Planning de la semaine suivante à confirmer (génération du jeudi, rappel du vendredi) : la vue Semaine
  // de cette semaine, service filtré (la page déduit semaine et service de la ligne de suivi : related_id).
  planning_a_confirmer: (id) => ({ id: "exploitation.planning", suite: id ? `?semaine_auto=${encodeURIComponent(id)}` : "" }),
  // Tournée fusionnée (alerte d'encadrement, related_id = ligne hôte du jour) : le Planning au jour de la fusion, tournée hôte mise en avant.
  planning_fusion: (id) => ({ id: "exploitation.planning", suite: id ? `?entry=${encodeURIComponent(id)}` : "" }),
  // Stock : article sous son seuil mini (tableau de bord), écart d'inventaire (inventaires), unités non rentrées (tableau de bord, vue tournées).
  stock_seuil: () => ({ id: "stock.accueil" }),
  stock_ecart: (id) => ({ id: "stock.inventaire", suite: id ? `?inventaire=${encodeURIComponent(id)}` : "" }),
  stock_non_rentre: (id) => ({ id: "stock.accueil", suite: id ? `?tournee=${encodeURIComponent(id)}#non-rentrees` : "" }),
  // Échéance RH (permis, visite médicale, fin de contrat, document) : la fiche du salarié.
  echeance_rh: (id) => (id ? { id: "equipe.utilisateur_fiche", params: { id } } : { id: "equipe.utilisateurs" }),
  // Sortie oubliée, pointage clos avec une heure estimée : la liste « Pointages à régulariser ».
  pointage_a_regulariser: () => ({ id: "equipe.pointage" }),
  // Facture impayée : les réglages de facturation (direction).
  paiement_echoue: () => ({ id: "admin.abonnement" }),
  // Arrêt de travail déclaré : à vérifier, tournées à remplacer (encadrement du service).
  work_stoppage: (id) => ({ id: "equipe.arrets", suite: id ? `?arret=${encodeURIComponent(id)}` : "" }),
};

/** Destinataire de l'alerte, quand le lien dépend de qui la lit. */
export interface ContexteDestinataire {
  /** alerts.recipient_user_id : alerte personnelle. */
  recipientUserId?: string | null;
  /** Rôle de la personne qui ouvre l'alerte (centre de notifications, cloche, destinataire d'un e-mail). */
  role?: UserRole | string | null;
  /**
   * La personne conduit (chauffeur, ou « conduit aussi »). Inconnu : un
   * chauffeur conduit ; une alerte personnelle vise la personne qui conduit
   * (rappel de planning, réponse sur son plein…).
   */
  conduit?: boolean | null;
  /** Modules actifs de l'organisation ; absents : pas de contrôle de module. */
  modules?: ReadonlySet<string> | readonly string[] | null;
}

/** URL d'une cible pour ce destinataire : l'écran, son alternative, ou le centre de notifications. */
function urlPour(cible: Cible, contexte?: ContexteDestinataire): string {
  if ("url" in cible) return cible.url;
  const e = ecran(cible.id);
  const role = contexte?.role as UserRole | null | undefined;
  if (role) {
    const modules = contexte?.modules ? new Set(contexte.modules) : null;
    const conduit = contexte?.conduit ?? (role === "chauffeur" || Boolean(contexte?.recipientUserId));
    // Sans liste de modules (e-mail), on ne juge que le rôle et la conduite.
    const decision = deciderAcces(e, role, modules ?? new Set([...(e.modules ?? []), ...(e.modulesAuMoinsUn ?? [])]), conduit);
    if (modules && horsOffreGoNavigation(e.id, modules)) return ACCUEIL_GO_NAVIGATION;
    if (!decision.ok) {
      if (decision.motif === "role" && decision.redirection) return decision.redirection;
      return modules && horsOffreGoNavigation("communication.alertes", modules) ? ACCUEIL_GO_NAVIGATION : urlDe("communication.alertes");
    }
  }
  return urlDe(cible.id, cible.params) + (cible.suite ?? "");
}

export function resolveAlertUrl(relatedTable: string | null, type?: string | null, relatedId?: string | null, contexte?: ContexteDestinataire): string | null {
  // Amende attribuée à un chauffeur (alerte personnelle) : sa fiche dans ses amendes.
  if ((type === "fine_notification" || (relatedTable === "fines" && !type)) && contexte?.recipientUserId) {
    return urlDe("moi.amendes") + (relatedId ? `?amende=${encodeURIComponent(relatedId)}` : "");
  }
  // Décision sur son arrêt (alerte personnelle) : ses arrêts.
  if ((type === "work_stoppage" || (relatedTable === "work_stoppages" && !type)) && contexte?.recipientUserId) {
    return urlDe("moi.arrets");
  }
  // Échéance de papiers du véhicule et consommation au-dessus de la référence (cron de la flotte) : la fiche du véhicule.
  if (relatedTable === "vehicles" && relatedId && (type === "echeance_vehicule" || type === "consumption_anomaly")) {
    return urlPour({ id: "flotte.vehicule_fiche", params: { id: relatedId }, suite: type === "echeance_vehicule" ? "#papiers" : "" }, contexte);
  }
  const parType = type ? CIBLE_PAR_TYPE[type] : undefined;
  if (parType) return urlPour(parType(relatedId ?? null), contexte);
  const id = relatedTable ? ECRAN_PAR_TABLE[relatedTable] : undefined;
  if (!id) return null;
  // Toute alerte liée à un plein ouvre ce plein (écart de prix, de totaliseur…).
  const suite = relatedTable === "fuel_entries" && relatedId ? `?plein=${encodeURIComponent(relatedId)}` : undefined;
  return urlPour({ id, suite }, contexte);
}
