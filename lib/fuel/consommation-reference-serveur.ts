import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { getVehicleConsumption } from "@/lib/vehicles/consumption";
import {
  FENETRE_CONSOMMATION_REFERENCE_JOURS,
  cleConsommationReference,
  ecartConsommationReference,
  messageConsommationReference,
} from "@/lib/fuel/consommation-reference";

/** Plafond de véhicules mesurés par organisation et par passage (trois requêtes chacun). */
const VEHICULES_MAX = 300;

/**
 * Alerte douce (information) pour chaque véhicule actif dont la consommation
 * des 30 derniers jours dépasse sa référence de plus de 25 % : une par véhicule
 * et par mois, envoyée à l'encadrement de son service, à l'exploitation et à la
 * direction. Jamais bloquant : colonne ou clé de dédoublonnage absente
 * (migration 20261108000002 pas appliquée), on ne crée rien.
 */
export async function surveillerConsommationReference(admin: SupabaseClient, organizationId: string, aujourdhui: string): Promise<{ creees: number }> {
  const { data, error } = await admin
    .from("vehicles")
    .select("id, registration, service_id, reference_consumption_l_100km")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .not("reference_consumption_l_100km", "is", null)
    .limit(VEHICULES_MAX);
  if (error) {
    if (!estSchemaManquant(error)) console.error("consommation de référence : véhicules", error.message);
    return { creees: 0 };
  }
  let creees = 0;
  for (const v of (data ?? []) as { id: string; registration: string; service_id: string | null; reference_consumption_l_100km: number | string }[]) {
    const mesuree = await getVehicleConsumption(admin, v.id, FENETRE_CONSOMMATION_REFERENCE_JOURS);
    const ecart = ecartConsommationReference(mesuree, v.reference_consumption_l_100km);
    if (!ecart?.anomalie || mesuree === null) continue;
    const { error: e } = await admin.from("alerts").insert({
      organization_id: organizationId,
      type: "consumption_anomaly",
      severity: "info",
      message: messageConsommationReference({ registration: v.registration, mesuree, reference: Number(v.reference_consumption_l_100km), ecartPourcent: ecart.ecartPourcent }),
      related_table: "vehicles",
      related_id: v.id,
      recipient_roles: v.service_id ? ["manager", "exploitation", "direction"] : ["exploitation", "direction"],
      cle_dedoublonnage: cleConsommationReference(v.id, aujourdhui),
      ...(v.service_id ? { service_id: v.service_id } : {}),
    });
    // 23505 : déjà signalé ce mois-ci (index unique). Colonne absente : migration pas appliquée.
    if (e && e.code !== "23505") {
      if (!estSchemaManquant(e) && !estValeurEnumInconnue(e)) console.error("consommation de référence : alerte", e.message);
      if (estSchemaManquant(e)) break;
    } else if (!e) creees++;
  }
  return { creees };
}
