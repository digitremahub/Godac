import "server-only";
import { cache } from "react";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { bornesMoisParis, debutJourParis, resoudreFormule, type UsageFeature } from "@/lib/usage/quotas";

export interface EtatQuotaFonction {
  fonction: UsageFeature;
  utilise: number;
  /** Volume inclus par mois dans la formule ; null = pas de quota défini. */
  inclus: number | null;
}

/** Libellés courts des jauges. */
export const LIBELLES_JAUGE: Record<UsageFeature, string> = {
  ocr_ticket: "Lectures de tickets ce mois",
  ocr_tour_report: "Lectures de rapports de tournée",
  tour_report_reread: "Relectures de rapports",
  ocr_counter: "Lectures de compteurs",
  ocr_totalizer: "Lectures de totalisateurs",
  ocr_fine: "Lectures d'avis de contravention",
  ocr_label: "Lectures d'étiquettes colis",
  contestation: "Lectures de contestations",
  vehicle_ai_specs: "Fiches véhicule complétées par IA",
  import_ai: "Imports assistés par IA",
  assistant: "Questions à l'assistant",
  route_optimization: "Optimisations de tournée",
  ocr_arret: "Lectures d'avis d'arrêt de travail",
};

const formuleDe = cache(async (organizationId: string) => {
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("organizations").select("plan").eq("id", organizationId).maybeSingle();
  return resoudreFormule(data?.plan as string | undefined);
});

/**
 * Consommation du mois et volume inclus de quelques fonctions payantes,
 * pour les jauges affichées là où le quota s'applique (Pleins, Revue OCR,
 * Tournée colis, Amendes, Contestations, assistant…). Lecture seule, avec
 * le client service (usage_events n'a pas de policy de lecture pour les
 * rôles de l'organisation). Toute erreur → jauge absente, jamais bloquant.
 */
export async function etatQuotas(organizationId: string, fonctions: readonly UsageFeature[]): Promise<EtatQuotaFonction[]> {
  try {
    const admin = createAdminSupabaseClient();
    const formule = await formuleDe(organizationId);
    const maintenant = new Date();
    const mois = bornesMoisParis(maintenant);
    const jour = debutJourParis(maintenant);
    const [{ data: quotas }, propres, ...totaux] = await Promise.all([
      admin.from("usage_quotas").select("feature, included_per_month").eq("plan_id", formule).in("feature", [...fonctions]),
      // Plafonds propres à l'organisation (essai GO Navigation) ; table absente → ignorés.
      admin.from("usage_quota_overrides").select("feature, included_per_month").eq("organization_id", organizationId).in("feature", [...fonctions]),
      ...fonctions.map((f) => admin.rpc("usage_feature_totals", { p_org: organizationId, p_feature: f, p_month_start: mois.debut, p_day_start: jour })),
    ]);
    const inclusPar = new Map((quotas ?? []).map((q: { feature: string; included_per_month: number | null }) => [q.feature, q.included_per_month]));
    for (const q of (propres.error ? [] : (propres.data ?? [])) as { feature: string; included_per_month: number | null }[]) inclusPar.set(q.feature, q.included_per_month);
    return fonctions.map((f, i) => {
      const t = totaux[i]?.data;
      const ligne = (Array.isArray(t) ? t[0] : t) as { month_units?: number } | null;
      const inclus = inclusPar.get(f);
      return { fonction: f, utilise: Number(ligne?.month_units ?? 0), inclus: inclus === undefined || inclus === null ? null : Number(inclus) };
    });
  } catch (e) {
    console.error("etatQuotas: lecture impossible", e);
    return [];
  }
}
