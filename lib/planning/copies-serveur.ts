import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/planning/dates";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";
import type { AffectationPlanning, PlanDeCopie } from "@/lib/planning/semaine";

const CHAMPS = "id, service_id, tour_number, driver_id, vehicle_id, start_at, status";

/**
 * Affectations existantes autour des jours visés (marge d'un jour de part
 * et d'autre : les jours de Paris ne tombent pas pile sur minuit UTC).
 * Lues avec le client de l'utilisateur : un manager ne voit que ses
 * services (RLS) — c'est aussi ce que l'insertion lui autorisera.
 */
export async function affectationsAutour(supabase: SupabaseClient, organizationId: string, dates: readonly string[]): Promise<AffectationPlanning[]> {
  if (dates.length === 0) return [];
  const triees = [...dates].sort();
  // Par pages de 1000 (limite PostgREST) : 8 semaines d'une grosse équipe peuvent dépasser.
  const out: AffectationPlanning[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from("planning_entries")
      .select(CHAMPS)
      .eq("organization_id", organizationId)
      .gte("start_at", `${addDays(triees[0]!, -1)}T00:00:00Z`)
      .lt("start_at", `${addDays(triees[triees.length - 1]!, 2)}T00:00:00Z`)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as AffectationPlanning[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type ResultatCopie =
  | { ok: true; creees: number; ignorees: number; conflits: number; ids: string[]; warning: string | null }
  | { ok: false; status: number; error: string };

/**
 * Inscrit un plan de copie (lib/planning/semaine.ts › planifierCopies) en
 * une seule insertion, toujours en « prévue ». Les conflits (chauffeur
 * déjà pris à la même heure) sont créés quand même et lèvent l'alerte
 * habituelle (warnIfDriverDoubleBooked), sans bloquer.
 */
export async function inscrireCopies(supabase: SupabaseClient, organizationId: string, plan: PlanDeCopie): Promise<ResultatCopie> {
  if (plan.aCreer.length === 0) return { ok: true, creees: 0, ignorees: plan.ignorees.length, conflits: 0, ids: [], warning: null };
  const lignes = plan.aCreer.map(({ sourceId: _source, ...l }) => ({ ...l, organization_id: organizationId, status: "planned" as const }));
  const { data, error } = await supabase.from("planning_entries").insert(lignes).select("id, driver_id, start_at");
  if (error) {
    if (error.code === "23505") {
      return { ok: false, status: 409, error: "Un des créneaux vient d'être occupé (même service, même tournée, même heure). Rechargez le planning puis réessayez." };
    }
    return { ok: false, status: 500, error: error.message };
  }
  const inserees = (data ?? []) as { id: string; driver_id: string | null; start_at: string }[];
  const enConflit = new Set(plan.conflits.map((c) => `${c.driver_id}|${Date.parse(c.start_at)}`));
  const warnings = (
    await Promise.all(
      inserees
        .filter((r) => r.driver_id && enConflit.has(`${r.driver_id}|${Date.parse(r.start_at)}`))
        .map((r) => warnIfDriverDoubleBooked(supabase, { organizationId, driverId: r.driver_id as string, startAt: r.start_at, excludeEntryId: r.id })),
    )
  ).filter((w): w is string => w !== null);
  return { ok: true, creees: inserees.length, ignorees: plan.ignorees.length, conflits: plan.conflits.length, ids: inserees.map((r) => r.id), warning: warnings[0] ?? null };
}
