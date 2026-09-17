import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The signed-in driver's own currently open tour, if any — used by
 * both the start flow (to block opening a second one) and the end
 * flow (to find what to close out and check it matches the scanned
 * vehicle).
 */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("planning_entries")
    .select("id, tour_number, start_at, start_km, vehicles(id, registration)")
    .eq("driver_id", appUser.id)
    .eq("status", "in_progress")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tour: data });
}
