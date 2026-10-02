import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/planning/dates";

const bodySchema = z.object({
  source_week_start: z.string().date(),
  target_week_start: z.string().date(),
  service_id: z.string().uuid().optional(),
});

/**
 * "Dupliquer la semaine précédente" — most drivers run the same route
 * week after week, so re-typing every tour by hand is the thing
 * managers actually complained about. Copies each source-week entry
 * 7 days forward as a new 'planned' row, same driver/vehicle/tour
 * number/time of day. Skipped per-driver-per-day when the target slot
 * already has *any* entry for that driver, so clicking it twice (or
 * duplicating into a week someone already partly filled by hand)
 * never creates doubles — the manager's own edits always win.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const sourceEnd = addDays(parsed.data.source_week_start, 7);
  const targetEnd = addDays(parsed.data.target_week_start, 7);
  const dayOffset =
    (new Date(`${parsed.data.target_week_start}T00:00:00`).getTime() - new Date(`${parsed.data.source_week_start}T00:00:00`).getTime()) /
    (24 * 60 * 60 * 1000);

  let sourceQuery = supabase
    .from("planning_entries")
    .select("service_id, tour_number, driver_id, vehicle_id, start_at")
    .gte("start_at", `${parsed.data.source_week_start}T00:00:00`)
    .lt("start_at", `${sourceEnd}T00:00:00`);
  if (parsed.data.service_id) sourceQuery = sourceQuery.eq("service_id", parsed.data.service_id);
  const { data: sourceEntries, error: sourceError } = await sourceQuery;
  if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 500 });
  if (!sourceEntries || sourceEntries.length === 0) {
    return NextResponse.json({ created: 0 });
  }

  const { data: existingTarget } = await supabase
    .from("planning_entries")
    .select("driver_id, start_at")
    .gte("start_at", `${parsed.data.target_week_start}T00:00:00`)
    .lt("start_at", `${targetEnd}T00:00:00`);
  const existingSlots = new Set((existingTarget ?? []).map((e) => `${e.driver_id}:${e.start_at.slice(0, 10)}`));

  const toInsert = sourceEntries
    .filter((e) => e.driver_id && e.vehicle_id)
    .map((e) => {
      const sourceStart = new Date(e.start_at);
      const targetStart = new Date(sourceStart.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      return {
        organization_id: appUser.organization_id,
        service_id: e.service_id,
        tour_number: e.tour_number,
        driver_id: e.driver_id,
        vehicle_id: e.vehicle_id,
        start_at: targetStart.toISOString(),
        status: "planned" as const,
        slotKey: `${e.driver_id}:${targetStart.toISOString().slice(0, 10)}`,
      };
    })
    .filter((e) => !existingSlots.has(e.slotKey))
    .map(({ slotKey: _omit, ...row }) => row);

  if (toInsert.length === 0) {
    return NextResponse.json({ created: 0 });
  }

  const { error: insertError, count } = await supabase.from("planning_entries").insert(toInsert, { count: "exact" });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ created: count ?? toInsert.length });
}
