import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateParis } from "@/lib/colis/heure-paris";
import { tourneeClotureeDepuisArrivee } from "@/lib/time-clock/sortie-depot";

/**
 * État des tournées d'un salarié pour décider de la sortie du dépôt :
 * - enCours : une tournée colis (delivery_runs.status = in_progress) ou
 *   une tournée du planning (planning_entries.status = in_progress) est
 *   ouverte, quelle que soit sa date ;
 * - cloturee : au moins une tournée clôturée depuis son arrivée
 *   (tourneeClotureeDepuisArrivee).
 * En cas d'erreur de lecture on suppose « en cours » : le doute ne doit
 * jamais fabriquer une sortie.
 */
export async function etatTourneesChauffeur(
  supabase: SupabaseClient,
  params: { organizationId: string; userId: string; clockedInAt: string },
): Promise<{ enCours: boolean; cloturee: boolean }> {
  const arrivee = new Date(params.clockedInAt);
  const jourArrivee = dateParis(Number.isNaN(arrivee.getTime()) ? new Date() : arrivee);

  const [colisEnCours, planningEnCours, colisClotures, planningClotures] = await Promise.all([
    supabase.from("delivery_runs").select("id").eq("driver_id", params.userId).eq("status", "in_progress").limit(1),
    supabase.from("planning_entries").select("id").eq("organization_id", params.organizationId).eq("driver_id", params.userId).eq("status", "in_progress").limit(1),
    supabase.from("delivery_runs").select("run_date").eq("driver_id", params.userId).eq("status", "done").gte("run_date", jourArrivee).limit(20),
    supabase
      .from("planning_entries")
      .select("end_at")
      .eq("organization_id", params.organizationId)
      .eq("driver_id", params.userId)
      .eq("status", "done")
      .gte("end_at", params.clockedInAt)
      .limit(20),
  ]);

  if (colisEnCours.error || planningEnCours.error) return { enCours: true, cloturee: false };
  const enCours = (colisEnCours.data?.length ?? 0) > 0 || (planningEnCours.data?.length ?? 0) > 0;
  const cloturee = tourneeClotureeDepuisArrivee({
    clockedInAt: params.clockedInAt,
    runsClotures: (colisClotures.data ?? []) as { run_date: string }[],
    planningCloture: (planningClotures.data ?? []) as { end_at: string | null }[],
  });
  return { enCours, cloturee };
}
