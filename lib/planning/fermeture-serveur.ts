import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { alertesAClore } from "@/lib/alerts/cloture";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";

/**
 * Clôt tout de suite les alertes « tournée sans chauffeur » et « tournée non
 * démarrée » des lignes du planning qu'on vient de fermer (sans attendre le
 * passage du cron, qui ne les recréerait de toute façon plus : une tournée
 * fermée n'est pas surveillée, lib/exploitation/surveillance.ts). Jamais
 * bloquant : type d'alerte absent (migration 20261106000001 pas appliquée) ou
 * erreur de lecture, la fermeture reste valable. Retourne le nombre d'alertes closes.
 */
export async function cloreAlertesDesTournees(organizationId: string, entreeIds: readonly string[]): Promise<number> {
  if (!entreeIds.length) return 0;
  try {
    const admin = createAdminSupabaseClient();
    const types = ["tournee_sans_chauffeur", "tournee_non_demarree"];
    const { data, error } = await admin
      .from("alerts")
      .select("id, type, related_id")
      .eq("organization_id", organizationId)
      .in("type", types)
      .in("related_id", [...entreeIds])
      .in("status", ["open", "acknowledged"])
      .limit(1000);
    if (error) {
      if (!estSchemaManquant(error) && !estValeurEnumInconnue(error)) console.warn("[planning] Alertes de tournées fermées non lues", error.message);
      return 0;
    }
    // Condition « encore vraie » vide pour chaque type : toutes les alertes de ces lignes se closent.
    const ids = alertesAClore((data ?? []) as { id: string; type: string; related_id: string | null }[], new Map(types.map((t) => [t, new Set<string>()])));
    if (!ids.length) return 0;
    const { error: e } = await admin.from("alerts").update({ status: "resolved", acknowledged_at: new Date().toISOString() }).eq("organization_id", organizationId).in("id", ids);
    if (e) {
      console.warn("[planning] Alertes de tournées fermées non closes", e.message);
      return 0;
    }
    return ids.length;
  } catch (e) {
    console.warn("[planning] Alertes de tournées fermées non closes", e instanceof Error ? e.message : e);
    return 0;
  }
}
