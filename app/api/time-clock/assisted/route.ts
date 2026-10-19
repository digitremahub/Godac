import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isModuleEnabled } from "@/lib/organization/modules";
import { buildDriverDepotsMap } from "@/lib/time-clock/driver-depots";
import { depotMatch } from "@/lib/time-clock/assisted";

const positionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative(),
});

const UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Pointage assisté (organizations.auto_clock_enabled, off by default).
 * Called once when the app opens, with the position read at that
 * moment — never a continuous track.
 * - Not clocked in and at one of the user's depots → clocks in
 *   (clock_in_source = 'auto'), undoable for 15 minutes via DELETE.
 * - Already clocked in → only reports whether they're at a depot, so
 *   the app can *offer* the clock-out; it never clocks out by itself.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["time_clock"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = positionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Position invalide." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const [timeClockEnabled, { data: organization }] = await Promise.all([
    isModuleEnabled(supabase, appUser.organization_id, "time_clock"),
    supabase.from("organizations").select("auto_clock_enabled").eq("id", appUser.organization_id).single(),
  ]);
  if (!timeClockEnabled || !organization?.auto_clock_enabled) {
    return NextResponse.json({ status: "disabled" });
  }

  const { depotsFor } = await buildDriverDepotsMap(supabase, appUser.organization_id);
  const point = { lat: parsed.data.latitude, lng: parsed.data.longitude };
  const match = depotMatch(point, parsed.data.accuracy, depotsFor(appUser.id));

  const { data: open } = await supabase
    .from("time_clock_entries")
    .select("id, clocked_in_at")
    .eq("user_id", appUser.id)
    .is("clocked_out_at", null)
    .maybeSingle();

  if (open) {
    return NextResponse.json({ status: "clocked_in", atDepot: Boolean(match), clockedInAt: open.clocked_in_at });
  }
  if (!match) {
    return NextResponse.json({ status: "not_at_depot" });
  }

  const { data: entry, error } = await supabase
    .from("time_clock_entries")
    .insert({
      organization_id: appUser.organization_id,
      user_id: appUser.id,
      clock_in_lat: point.lat,
      clock_in_lng: point.lng,
      clock_in_source: "auto",
    })
    .select("id, clocked_in_at")
    .single();
  // Pointage déjà ouvert entre-temps (index unique, audit M1).
  if (error?.code === "23505") return NextResponse.json({ status: "clocked_in", atDepot: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ status: "auto_clocked_in", entryId: entry.id, clockedInAt: entry.clocked_in_at, distanceM: match.distanceM });
}

/**
 * « Annuler » on the assisted clock-in banner. RLS has no delete
 * policy on time_clock_entries (a badge is a record, not a draft), so
 * this goes through the service role and only ever removes the
 * caller's own, still-open, *assisted* entry from the last 15 minutes.
 */
export async function DELETE(req: Request) {
  const g2 = await garderApi({ modules: ["time_clock"] });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  const entryId = new URL(req.url).searchParams.get("id");
  if (!entryId || !/^[0-9a-f-]{36}$/i.test(entryId)) {
    return NextResponse.json({ error: "Pointage introuvable." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: entry } = await admin
    .from("time_clock_entries")
    .select("id, user_id, organization_id, clock_in_source, clocked_out_at, clocked_in_at")
    .eq("id", entryId)
    .maybeSingle();

  if (
    !entry ||
    entry.user_id !== appUser.id ||
    entry.organization_id !== appUser.organization_id ||
    entry.clock_in_source !== "auto" ||
    entry.clocked_out_at !== null ||
    Date.now() - new Date(entry.clocked_in_at).getTime() > UNDO_WINDOW_MS
  ) {
    return NextResponse.json({ error: "Ce pointage ne peut plus être annulé." }, { status: 409 });
  }

  const { error } = await admin.from("time_clock_entries").delete().eq("id", entry.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "undone" });
}
