import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({ target_date: z.string().date().optional() });

/**
 * "Dupliquer une case" — clone a single entry, same driver/vehicle/
 * tour number/time of day, to a chosen day (target_date) or, if none
 * given, the same weekday next week. The per-cell counterpart to
 * /api/planning/duplicate-week, for the case where only one driver's
 * tour needs projecting forward rather than the whole week (e.g. it
 * was skipped by the week-duplicate because that slot already had
 * something, or the manager just wants to repeat this one tour on a
 * specific day). Works from any source status (planned/in_progress/
 * done) — the clone itself is always a fresh 'planned' row.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = await createServerSupabaseClient();

  const { data: source, error: sourceError } = await supabase
    .from("planning_entries")
    .select("service_id, tour_number, driver_id, vehicle_id, start_at")
    .eq("id", id)
    .single();
  if (sourceError || !source) {
    return NextResponse.json({ error: "Affectation introuvable." }, { status: 404 });
  }

  // Shift by a whole number of days from the source's own date so the
  // time of day is preserved exactly, same technique as
  // /api/planning/duplicate-week's dayOffset — rather than
  // reconstructing the instant from scratch (which would have to
  // guess which time zone the chosen date-only string means).
  let dayOffset = 7;
  if (parsed.data.target_date) {
    const sourceDay = source.start_at.slice(0, 10);
    dayOffset =
      (new Date(`${parsed.data.target_date}T00:00:00Z`).getTime() - new Date(`${sourceDay}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000);
  }
  const targetStart = new Date(new Date(source.start_at).getTime() + dayOffset * 24 * 60 * 60 * 1000);

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
        { error: "Une affectation existe déjà pour ce service, ce numéro de tournée et cette date/heure." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
