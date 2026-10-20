import { ecran, urlDe } from "@/lib/acces/catalogue";
import type { UserRole } from "@/lib/types/domain";

/**
 * Lien d'une alerte : la page où le problème se traite. Partagé par le
 * centre d'alertes (components/alerts/AlertList.tsx), la cloche
 * (app/api/notifications) et les e-mails et notifications push
 * (app/api/webhooks/supabase-alerts, une URL par rôle destinataire).
 *
 * Toutes les adresses viennent du catalogue (urlDe) : aucun lien ne passe
 * par une redirection. Quand le rôle du destinataire est connu et qu'il ne
 * peut pas ouvrir l'écran, on prend l'alternative prévue par le catalogue
 * (ex. amendes → Mes amendes pour un chauffeur), sinon le centre d'alertes.
 */

/** Écran de traitement par table liée. */
const ECRAN_PAR_TABLE: Record<string, string> = {
  fuel_entries: "carburant.pleins",
  vehicle_interventions: "flotte.entretien",
  tank_deliveries: "carburant.approvisionnements",
  fines: "flotte.amendes",
  customer_disputes: "exploitation.contestations",
  rental_maintenance_requests: "flotte.loueurs_demandes",
  planning_entries: "exploitation.historique",
  support_requests: "communication.assistance",
  meeting_requests: "communication.intranet",
  convocations: "communication.intranet",
  payslips: "equipe.paie",
};

type Cible = { id: string; params?: Record<string, string>; suite?: string } | { url: string };

/**
 * Surcharges par type d'alerte, avant la table liée. `relatedId` sert
 * aux liens vers une ligne précise (expéditeur d'un message, véhicule…).
 */
const CIBLE_PAR_TYPE: Record<string, (relatedId: string | null) => Cible> = {
  planning_validated: () => ({ id: "moi.planning" }),
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
  // Écart carburant (explication demandée au chauffeur, ou sa réponse) :
  // le plein ouvert dans l'historique, fiche dépliée.
  fuel_gap_explanation: (id) => ({ id: "carburant.pleins", suite: id ? `?plein=${encodeURIComponent(id)}` : "" }),
};

/** Destinataire de l'alerte, quand le lien dépend de qui la lit. */
export interface ContexteDestinataire {
  /** alerts.recipient_user_id : alerte personnelle. */
  recipientUserId?: string | null;
  /** Rôle de la personne qui ouvre l'alerte (centre d'alertes, cloche, destinataire d'un e-mail). */
  role?: UserRole | string | null;
}

/** URL d'une cible pour ce rôle : l'écran, son alternative, ou le centre d'alertes. */
function urlPour(cible: Cible, role?: string | null): string {
  if ("url" in cible) return cible.url;
  const e = ecran(cible.id);
  if (role && !e.roles.includes(role as UserRole)) {
    return e.alternative?.[role as UserRole] ?? urlDe("communication.alertes");
  }
  return urlDe(cible.id, cible.params) + (cible.suite ?? "");
}

export function resolveAlertUrl(relatedTable: string | null, type?: string | null, relatedId?: string | null, contexte?: ContexteDestinataire): string | null {
  // Amende attribuée à un chauffeur (alerte personnelle) : ses amendes.
  if ((type === "fine_notification" || (relatedTable === "fines" && !type)) && contexte?.recipientUserId) return urlDe("moi.amendes");
  const parType = type ? CIBLE_PAR_TYPE[type] : undefined;
  if (parType) return urlPour(parType(relatedId ?? null), contexte?.role);
  const id = relatedTable ? ECRAN_PAR_TABLE[relatedTable] : undefined;
  return id ? urlPour({ id }, contexte?.role) : null;
}
