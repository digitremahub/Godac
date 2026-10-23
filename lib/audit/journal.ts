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
  rapport_correction: "Rapport de tournée corrigé",
  rapport_relecture: "Scans de rapport relus",
  plein_modification: "Plein modifié",
  ecart_carburant_traite: "Écart carburant justifié / classé",
  ecart_carburant_explication: "Explication demandée au chauffeur sur un écart carburant",
  livraison_cuve_annulee: "Livraison de cuve annulée",
  role_modifie: "Rôle ou accès modifié",
  pin_reinitialise: "Code PIN réinitialisé",
  acces_chauffeurs_reinitialises: "Accès chauffeurs réinitialisés (tous)",
  pin_bloque: "Code PIN bloqué (trop d'essais)",
  utilisateur_desactive: "Compte désactivé / réactivé",
  tournee_colis_supprimee: "Tournée colis supprimée",
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
  arret_affectations_liberees: "Affectations du planning libérées (salarié en arrêt)",
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
