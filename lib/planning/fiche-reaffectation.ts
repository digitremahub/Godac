import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { sortFicheAncienChauffeur } from "@/lib/planning/affectation";

/**
 * Changement de chauffeur sur une affectation prévue : la fiche Tournée
 * colis préparée pour l'ancien chauffeur (lib/colis/fiche-du-jour.ts) ne
 * doit pas lui rester. Décision dans lib/planning/affectation.ts ›
 * sortFicheAncienChauffeur. Au mieux : sans les colonnes de fiches par
 * affectation (migration 20261023000002) ou en cas d'erreur, on ne touche
 * à rien et on renvoie un avertissement lisible, jamais une erreur.
 */
export async function libererFicheAncienChauffeur(supabase: SupabaseClient, entreeId: string): Promise<string | null> {
  try {
    const { data: entree, error: e1 } = await supabase.from("planning_entries").select("id, delivery_run_id").eq("id", entreeId).maybeSingle();
    if (e1) return estSchemaManquant(e1) ? null : AVERTISSEMENT;
    const { data: parOrigine } = await supabase.from("delivery_runs").select("id").eq("planning_entry_id", entreeId).maybeSingle();
    const runId = (entree?.delivery_run_id as string | null) ?? (parOrigine?.id as string | undefined) ?? null;
    if (!runId) return null;

    const [{ data: run, error: e2 }, { data: autres }, { count: traites }] = await Promise.all([
      supabase.from("delivery_runs").select("id, status, planning_entry_id, fiche_planifiee").eq("id", runId).maybeSingle(),
      supabase.from("planning_entries").select("id").eq("delivery_run_id", runId).neq("id", entreeId),
      supabase.from("delivery_stops").select("id", { count: "exact", head: true }).eq("run_id", runId).neq("status", "pending"),
    ]);
    if (e2 || !run) return null;

    const sort = sortFicheAncienChauffeur({
      statut: run.status as string,
      arretsTraites: traites ?? 0,
      autresEntrees: (autres ?? []).length,
      fichePlanifiee: Boolean(run.fiche_planifiee),
      creeePourCetteAffectation: run.planning_entry_id === entreeId,
    });
    if (sort === "garder") return "La tournée colis de l'ancien chauffeur est déjà commencée : elle reste à son nom, vérifiez-la.";

    // Détacher d'abord : l'affectation ne pointe plus vers la fiche.
    await supabase.from("planning_entries").update({ delivery_run_id: null }).eq("id", entreeId);
    if (sort === "supprimer") {
      const { error } = await supabase.from("delivery_runs").delete().eq("id", runId).eq("status", "loading");
      if (error) return AVERTISSEMENT;
    } else if (run.planning_entry_id === entreeId) {
      await supabase.from("delivery_runs").update({ planning_entry_id: null }).eq("id", runId);
    }
    return null;
  } catch (e) {
    console.warn("[planning/fiche-reaffectation] Fiche de l'ancien chauffeur non libérée", { entreeId, error: e instanceof Error ? e.message : e });
    return AVERTISSEMENT;
  }
}

const AVERTISSEMENT = "La tournée colis préparée pour l'ancien chauffeur n'a pas pu être retirée : supprimez-la depuis Tournée colis si besoin.";
