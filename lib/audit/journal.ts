import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Actions tracées dans le journal d'audit (libellés affichés à la direction). */
export const ACTIONS_AUDIT = {
  ticpe_export: "Export TICPE généré",
  ticpe_correction: "Ligne TICPE corrigée / confirmée",
  rapport_correction: "Rapport de tournée corrigé",
  rapport_relecture: "Scans de rapport relus",
  plein_modification: "Plein modifié",
  livraison_cuve_annulee: "Livraison de cuve annulée",
  role_modifie: "Rôle ou accès modifié",
  pin_reinitialise: "Code PIN réinitialisé",
  pin_bloque: "Code PIN bloqué (trop d'essais)",
  utilisateur_desactive: "Compte désactivé / réactivé",
  tournee_colis_supprimee: "Tournée colis supprimée",
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
