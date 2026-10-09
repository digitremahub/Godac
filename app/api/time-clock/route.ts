import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

/**
 * Toggles the caller's own clock state — one open entry
 * (clocked_out_at is null) at a time. No service scoping or approval
 * step in this first version: it's a raw log, not a payroll source of
 * truth yet (see /reporting for aggregated hours).
 */
export async function POST() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const timeClockEnabled = await isModuleEnabled(supabase, appUser.organization_id, "time_clock");
  if (!timeClockEnabled) {
    return NextResponse.json({ error: "Module Pointeuse non activé." }, { status: 403 });
  }

  const { data: open } = await supabase
    .from("time_clock_entries")
    .select("id")
    .eq("user_id", appUser.id)
    .is("clocked_out_at", null)
    .maybeSingle();

  if (open) {
    const { error } = await supabase.from("time_clock_entries").update({ clocked_out_at: new Date().toISOString() }).eq("id", open.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "clocked_out" });
  }

  const { error } = await supabase.from("time_clock_entries").insert({
    organization_id: appUser.organization_id,
    user_id: appUser.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "clocked_in" });
}
