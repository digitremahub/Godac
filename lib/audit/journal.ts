import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Actions tracées dans le journal d'audit (libellés affichés à la direction). */
export const ACTIONS_AUDIT = {
  ticpe_export: "Export TICPE généré",
  ticpe_correction: "Ligne TICPE corrigée / confirmée",
  ticpe_reglages_modifies: "Réglages TICPE modifiés",
  ticpe_surcharge_ajoutee: "Taux TICPE particulier ajouté (surcharge du barème)",
  ticpe_surcharge_revoquee: "Taux TICPE particulier révoqué",
  ticpe_vehicule_modifie: "Véhicule : informations TICPE modifiées",
  ticpe_carte_grise_confirmee: "Carte grise lue et confirmée (TICPE)",
  ticpe_periode_declaree: "Période TICPE marquée déclarée",
  ticpe_declaration_annulee: "Déclaration TICPE annulée",
  ticpe_document_genere: "Document TICPE généré (3310-TIC, ERA, dossier)",
  ticpe_document_force: "Document TICPE généré malgré des points bloquants non résolus",
  rapport_correction: "Rapport de tournée corrigé",
  rapport_relecture: "Scans de rapport relus",
  plein_modification: "Plein modifié",
  plein_doublon_leve: "Doublon probable levé : deux pleins distincts confirmés",
  plein_controle_confirme: "Plein enregistré malgré un contrôle (kilométrage, réservoir) confirmé avec un motif",
  plein_ticket_joint: "Justificatif (photo du ticket) joint ou remplacé sur un plein",
  plein_correction_lot: "Correction groupée de points bloquants TICPE (justificatif, zone, doublon)",
  export_pleins: "Export comptable des pleins (CSV ou Excel)",
  ecart_carburant_traite: "Écart carburant justifié / classé",
  ecart_carburant_explication: "Explication demandée au chauffeur sur un écart carburant",
  livraison_cuve_annulee: "Livraison de cuve annulée",
  role_modifie: "Rôle ou accès modifié",
  pin_reinitialise: "Code PIN réinitialisé",
  acces_chauffeurs_reinitialises: "Accès chauffeurs réinitialisés (tous)",
  pin_bloque: "Code PIN bloqué (trop d'essais)",
  utilisateur_desactive: "Compte désactivé / réactivé",
  tournee_colis_supprimee: "Tournée colis supprimée",
  tournee_colis_rouverte: "Tournée colis clôturée rouverte par l'encadrement",
  paie_bulletin_genere: "Bulletin de paie généré (en attente de validation)",
  paie_bulletin_valide: "Bulletin de paie validé par la direction",
  paie_bulletin_refuse: "Bulletin de paie refusé par la direction",
  paie_sortie_enregistree: "Sortie d'un salarié enregistrée (paie)",
  paie_acompte_decision: "Demande d'acompte : décision ou préparation",
  paie_export_comptable: "Export de paie pour le comptable (CSV, journal)",
  paie_bulletins_archive: "Archive ZIP de bulletins de paie téléchargée",
  paie_remise_choix: "Remise des bulletins : choix du salarié (électronique / papier)",
  registre_personnel_modifie: "Registre du personnel : fiche complétée",
  registre_personnel_export: "Registre du personnel exporté",
  inscription_go_navigation: "Compte d'essai GO Navigation créé (invitation)",
  go_apporteur_lien_cree: "Lien personnel « Faire essayer GO » créé ou régénéré",
  go_apporteur_lien_revoque: "Lien personnel « Faire essayer GO » révoqué",
  go_apporteur_invitation_creee: "Invitation à usage unique « Faire essayer GO » créée",
  go_apporteur_invitation_revoquee: "Invitation « Faire essayer GO » révoquée",
  go_apporteur_droit_modifie: "Droit « Faire essayer GO » modifié (personne ou toute l'équipe)",
  accord_usage_essai: "Essai GO : accord de partage du détail d'usage donné ou retiré",
  usage_essai_detail_consulte: "Essai GO : détail d'usage consulté par GODAC (avec accord)",
  recommandation_employeur: "Recommandation d'employeur envoyée à GODAC (GO)",
  amende_creee: "Amende enregistrée (avis joint)",
  amende_responsable_valide: "Amende : responsable validé et notifié",
  amende_statut_modifie: "Amende réglée / contestée / classée",
  contestation_creee: "Contestation client enregistrée (pièces jointes)",
  contestation_responsable_valide: "Contestation client : responsable validé et notifié",
  contestation_cloturee: "Contestation client réglée / contestée / classée",
  contestation_suite_chauffeur: "Contestation client signalée traitée / colis rendu par le chauffeur",
  arret_declare: "Arrêt de travail déclaré ou saisi",
  arret_decision: "Arrêt de travail validé, refusé ou corrigé",
  demande_auto_validee: "Demande auto-validée (direction unique)",
  pointage_sortie_auto: "Sortie pointée automatiquement (départ du dépôt)",
  pointage_sortie_auto_annulee: "Sortie automatique annulée par le salarié",
  pointage_sortie_derniere_presence: "Sortie pointée à la dernière présence au dépôt (choix du salarié)",
  export_tournees: "Export des tournées colis (historique ou suivi du jour, CSV ou PDF)",
  traitement_groupe: "Traitement groupé (À traiter aujourd'hui) : nombre d'éléments traités et refusés",
  arret_affectations_liberees: "Affectations du planning libérées (salarié en arrêt)",
  tournee_fermee: "Tournée du planning fermée",
  tournee_rouverte: "Tournée du planning rouverte",
  tournee_fusion_modifiee: "Tournée fusionnée (lundi) : tournées d'origine modifiées",
  tournee_repartition_modifiee: "Tournée fusionnée : villages et ramasses répartis (provisoire)",
  tournee_repartition_reconciliee: "Tournée fusionnée : répartition alignée sur les tournées réelles",
  pointage_cloture_auto: "Pointages restés ouverts clos automatiquement (sortie estimée, à régulariser)",
  pointage_regularise: "Pointage régularisé (heure de sortie corrigée, avec motif)",
  pointage_ajoute: "Pointage manquant ajouté par l'encadrement (avec motif)",
  planning_affectation: "Planning : chauffeur affecté, remplacé ou retiré d'une tournée",
  planning_tournee_retiree: "Planning : tournée ou présence supprimée",
  conge_decision: "Congé approuvé ou refusé",
  conge_affectations_liberees: "Affectations du planning libérées (congé approuvé)",
  paie_profil_modifie: "Profil de paie modifié (taux horaire, régime, heures)",
  contrat_modifie: "Contrat ou rémunération modifié",
  utilisateur_invite: "Utilisateur invité ou créé (rôle attribué)",
  organisation_modifiee: "Paramètres de l'organisation modifiés",
  paie_lot_prepare: "Paie du mois préparée en lot (bulletins en attente de validation)",
  paie_prime_marquee: "Prime marquée récurrente ou ponctuelle",
  facturation_impaye: "Paiement échoué enregistré (facture Stripe impayée)",
  palier_stripe_echec: "Palier d'utilisateurs : mise à jour Stripe en échec (reprise au prochain passage)",
} as const;
export type ActionAudit = keyof typeof ACTIONS_AUDIT;

/**
 * Trace une action sensible. Ne fait jamais échouer l'opération métier :
 * une erreur d'écriture du journal est seulement consignée dans les logs.
 * Jamais de mot de passe, de PIN ni de jeton dans `details`.
 */
export async function journaliser(params: {
  organizationId: string;
  userId: string | null;
  action: ActionAudit;
  targetTable?: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    const { error } = await createAdminSupabaseClient().from("audit_log").insert({
      organization_id: params.organizationId,
      user_id: params.userId,
      action: params.action,
      target_table: params.targetTable ?? null,
      target_id: params.targetId ?? null,
      details: params.details ?? null,
    });
    if (error) console.error("journal d'audit", error.message);
  } catch (e) {
    console.error("journal d'audit", e);
  }
}
