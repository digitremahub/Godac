import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The signed-in driver's own currently open tour, if any — used by
 * both the start flow (to block opening a second one) and the end
 * flow (to find what to close out and check it matches the scanned
 * vehicle). Also returns today's still-"planned" entry, if a manager
 * already planned one — StartTourFlow pre-fills from it and passes
 * its id back explicitly, so opening the tour updates that same row
 * (see app/api/tours/route.ts) instead of relying on the driver
 * retyping a matching tour number.
 */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const [openRes, plannedRes] = await Promise.all([
    supabase
      .from("planning_entries")
      .select("id, tour_number, start_at, start_km, vehicles(id, registration)")
      .eq("driver_id", appUser.id)
      .eq("status", "in_progress")
      .maybeSingle(),
    supabase
      .from("planning_entries")
      .select("id, tour_number, start_at, vehicles(id, registration)")
      .eq("driver_id", appUser.id)
      .eq("status", "planned")
      .gte("start_at", todayStart.toISOString())
      .lt("start_at", todayEnd.toISOString())
      .order("start_at")
      .limit(1),
  ]);

  if (openRes.error) return NextResponse.json({ error: openRes.error.message }, { status: 500 });
  return NextResponse.json({ tour: openRes.data, plannedToday: plannedRes.data?.[0] ?? null });
}
