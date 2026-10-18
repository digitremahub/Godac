import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isModuleEnabled } from "@/lib/organization/modules";
import { parisCalendarDate } from "@/lib/planning/dates";

type PlanningAssignment = {
  id: string;
  organization_id: string;
  service_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  tour_number: string;
  start_at: string;
};

/**
 * Ensures that a Planning assignment has a corresponding parcel-scanning
 * tour. Matching by organization + driver + Paris date + tour label makes
 * this safe to call from single and bulk assignment endpoints.
 */
export async function synchroniserTourneeColis(supabase: SupabaseClient, entry: PlanningAssignment) {
  if (!entry.driver_id || !(await isModuleEnabled(supabase, entry.organization_id, "route_optimizer"))) return null;

  const runDate = parisCalendarDate(entry.start_at);
  const runName = `Tournée n°${entry.tour_number}`;
  const plannedStart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(entry.start_at));

  // La relation explicite est prioritaire : le libellé peut changer sans créer
  // une seconde tournée pour la même affectation Planning.
  const { data: linked, error: linkedError } = await supabase
    .from("delivery_runs")
    .select("id")
    .eq("organization_id", entry.organization_id)
    .eq("planning_entry_id", entry.id)
    .maybeSingle();
  if (linkedError) throw new Error(linkedError.message);

  const { data: existing, error: lookupError } = linked
    ? { data: linked, error: null }
    : await supabase
        .from("delivery_runs")
        .select("id")
        .eq("organization_id", entry.organization_id)
        .eq("driver_id", entry.driver_id)
        .eq("run_date", runDate)
        .eq("name", runName)
        .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  if (existing) {
    const { error } = await supabase
      .from("delivery_runs")
      .update({ vehicle_id: entry.vehicle_id, service_id: entry.service_id, planned_start: plannedStart, planning_entry_id: entry.id })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return existing.id;
  }

  const { data: run, error } = await supabase
    .from("delivery_runs")
    .insert({
      organization_id: entry.organization_id,
      planning_entry_id: entry.id,
      driver_id: entry.driver_id,
      vehicle_id: entry.vehicle_id,
      service_id: entry.service_id,
      run_date: runDate,
      name: runName,
      planned_start: plannedStart,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return run.id;
}
