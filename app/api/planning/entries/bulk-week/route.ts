import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  tour_number: z.string().min(1),
  week_start: z.string().date(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  // Which weekdays (0 = Monday .. 6 = Sunday) to fill in — defaults to
  // the whole week so "assigner toute la semaine" needs one click,
  // while still letting a manager uncheck e.g. the weekend.
  days: z.array(z.number().int().min(0).max(6)).min(1).default([0, 1, 2, 3, 4, 5, 6]),
});

/**
 * "Ajouter tous les jours d'une semaine d'un chauffeur directement" —
 * the week-at-once counterpart to the single-day form already in
 * planning (aujourd'hui la fiche chauffeur, DriverWeekSheet). Same driver/vehicle/tour number every day, only the
 * date changes — skips any day that already has an entry for this
 * service/tour_number/time (same real-constraint shape as
 * duplicate-week and duplicate-entry) instead of letting the DB
 * reject the whole batch over one collision.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!["direction", "manager", "exploitation"].includes(appUser.role)) {
    return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d’équipe peut attribuer une tournée." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { service_id, driver_id, vehicle_id, tour_number, week_start, time, days } = parsed.data;
  const weekEnd = addDays(week_start, 7);

  const { data: existing } = await supabase
    .from("planning_entries")
    .select("tour_number, start_at")
    .eq("service_id", service_id)
    .gte("start_at", `${week_start}T00:00:00`)
    .lt("start_at", `${weekEnd}T00:00:00`);
  const existingSlots = new Set((existing ?? []).map((e) => `${e.tour_number}:${e.start_at}`));

  const rows = days
    .map((offset) => {
      const day = addDays(week_start, offset);
      const startAt = parisWallTimeToUtcISOString(day, time);
      return { startAt, slotKey: `${tour_number}:${startAt}` };
    })
    .filter((r) => !existingSlots.has(r.slotKey))
    .map((r) => ({
      organization_id: appUser.organization_id,
      service_id,
      tour_number,
      driver_id,
      vehicle_id,
      start_at: r.startAt,
      status: "planned" as const,
    }));

  const skipped = days.length - rows.length;
  if (rows.length === 0) {
    return NextResponse.json({ created: 0, skipped });
  }

  const { data: inserted, error, count } = await supabase.from("planning_entries").insert(rows, { count: "exact" }).select("id, organization_id, service_id, driver_id, vehicle_id, tour_number, start_at");
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Certains jours de cette semaine ont déjà une affectation pour ce service/numéro de tournée." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }


  const warnings = (
    await Promise.all(
      (inserted ?? []).map((row) =>
        warnIfDriverDoubleBooked(supabase, {
          organizationId: appUser.organization_id,
          driverId: driver_id,
          startAt: row.start_at,
          excludeEntryId: row.id,
        }),
      ),
    )
  ).filter((w): w is string => w !== null);

  return NextResponse.json({ created: count ?? rows.length, skipped, warning: warnings[0] ?? null });
}
