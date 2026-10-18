import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/planning/dates";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";

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
  if (!["direction", "manager", "manager_chauffeur"].includes(appUser.role)) {
    return NextResponse.json(
      { error: "Seule la Direction ou un responsable autorisé peut générer une semaine de planning." },
      { status: 403 },
    );
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const sourceEnd = addDays(parsed.data.source_week_start, 7);
  const targetEnd = addDays(parsed.data.target_week_start, 7);
  const dayOffset =
    (new Date(`${parsed.data.target_week_start}T00:00:00Z`).getTime() - new Date(`${parsed.data.source_week_start}T00:00:00Z`).getTime()) /
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

  // Keyed on the same columns as planning_entries' real unique
  // constraint (organization_id, service_id, tour_number, start_at) —
  // this used to be keyed on driver_id:day instead, which both let a
  // same-service/same-tour-number collision from a different driver
  // through to the DB (raw 409) and silently dropped a same-driver
  // entry that used a *different* tour number on a day that already
  // had something else of theirs.
  const { data: existingTarget } = await supabase
    .from("planning_entries")
    .select("service_id, tour_number, start_at")
    .gte("start_at", `${parsed.data.target_week_start}T00:00:00`)
    .lt("start_at", `${targetEnd}T00:00:00`);
  const existingSlots = new Set((existingTarget ?? []).map((e) => `${e.service_id}:${e.tour_number}:${e.start_at}`));

  const toInsert = sourceEntries
    .filter((e) => e.driver_id && e.vehicle_id)
    .map((e) => {
      const sourceStart = new Date(e.start_at);
      const targetStart = new Date(sourceStart.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const targetStartIso = targetStart.toISOString();
      return {
        organization_id: appUser.organization_id,
        service_id: e.service_id,
        tour_number: e.tour_number,
        driver_id: e.driver_id,
        vehicle_id: e.vehicle_id,
        start_at: targetStartIso,
        status: "planned" as const,
        slotKey: `${e.service_id}:${e.tour_number}:${targetStartIso}`,
      };
    })
    .filter((e) => !existingSlots.has(e.slotKey))
    .map(({ slotKey: _omit, ...row }) => row);

  if (toInsert.length === 0) {
    return NextResponse.json({ created: 0 });
  }

  const { data: inserted, error: insertError, count } = await supabase
    .from("planning_entries")
    .insert(toInsert, { count: "exact" })
    .select("id, driver_id, start_at");
  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "Certaines affectations existent déjà pour cette semaine (numéro de tournée déjà utilisé à cette date)." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const warnings = (
    await Promise.all(
      (inserted ?? [])
        .filter((row) => row.driver_id)
        .map((row) =>
          warnIfDriverDoubleBooked(supabase, {
            organizationId: appUser.organization_id,
            driverId: row.driver_id as string,
            startAt: row.start_at,
            excludeEntryId: row.id,
          }),
        ),
    )
  ).filter((w): w is string => w !== null);

  return NextResponse.json({ created: count ?? toInsert.length, warning: warnings[0] ?? null });
}
