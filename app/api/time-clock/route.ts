import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

/**
 * Toggles the caller's own clock state — one open entry
 * (clocked_out_at is null) at a time. No service scoping or approval
 * step, and deliberately not wired into payroll/hours yet (see
 * app/(dashboard)/time-clock) — this is purely a comparison tool for
 * now: the captured coordinates (browser geolocation, best-effort —
 * never blocks the badge if denied/unavailable) let direction
 * cross-check a badge against the depot or the driver's home
 * (lib/time-clock/classify-location.ts), nothing more.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const timeClockEnabled = await isModuleEnabled(supabase, appUser.organization_id, "time_clock");
  if (!timeClockEnabled) {
    return NextResponse.json({ error: "Module Pointeuse non activé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const latitude = parsed.success ? parsed.data.latitude : undefined;
  const longitude = parsed.success ? parsed.data.longitude : undefined;

  const { data: open } = await supabase
    .from("time_clock_entries")
    .select("id")
    .eq("user_id", appUser.id)
    .is("clocked_out_at", null)
    .maybeSingle();

  if (open) {
    const { error } = await supabase
      .from("time_clock_entries")
      .update({
        clocked_out_at: new Date().toISOString(),
        clock_out_lat: latitude ?? null,
        clock_out_lng: longitude ?? null,
      })
      .eq("id", open.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "clocked_out" });
  }

  const { error } = await supabase.from("time_clock_entries").insert({
    organization_id: appUser.organization_id,
    user_id: appUser.id,
    clock_in_lat: latitude ?? null,
    clock_in_lng: longitude ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "clocked_in" });
}
