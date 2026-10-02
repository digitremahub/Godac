import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * "Dupliquer une case" — clone a single entry to the same weekday next
 * week, same driver/vehicle/tour number/time of day. The per-cell
 * counterpart to /api/planning/duplicate-week, for the case where only
 * one driver's tour needs projecting forward rather than the whole
 * week (e.g. it was skipped by the week-duplicate because that slot
 * already had something, or the manager just wants to repeat this one
 * tour next week). Works from any source status (planned/in_progress/
 * done) — the clone itself is always a fresh 'planned' row.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: source, error: sourceError } = await supabase
    .from("planning_entries")
    .select("service_id, tour_number, driver_id, vehicle_id, start_at")
    .eq("id", id)
    .single();
  if (sourceError || !source) {
    return NextResponse.json({ error: "Affectation introuvable." }, { status: 404 });
  }

  const targetStart = new Date(new Date(source.start_at).getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("planning_entries")
    .insert({
      organization_id: appUser.organization_id,
      service_id: source.service_id,
      tour_number: source.tour_number,
      driver_id: source.driver_id,
      vehicle_id: source.vehicle_id,
      start_at: targetStart.toISOString(),
      status: "planned",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Une affectation existe déjà pour ce service, ce numéro de tournée et cette date/heure la semaine prochaine." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
