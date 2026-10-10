import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { mondayOf, toISODate, addDays } from "@/lib/planning/dates";

interface DigestEntry {
  tour_number: string;
  start_at: string;
  vehicles: { registration: string } | null;
}

function buildDigestMessage(entries: DigestEntry[]): string {
  const lines = entries.map((e) => {
    const d = new Date(e.start_at);
    const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    return `${day} ${time} — n°${e.tour_number}${e.vehicles ? ` (${e.vehicles.registration})` : ""}`;
  });
  return `Votre planning de la semaine prochaine :\n${lines.join("\n")}`;
}

/**
 * Vercel Cron, Saturdays (see vercel.json) — the weekly digest
 * replicates the paper/WhatsApp habit of handing each driver their
 * full next-week schedule in one go, as a complement to the
 * per-assignment notifications the planning_entries_after_upsert
 * trigger already sends the moment a manager plans or moves a tour.
 * Runs with the service-role client (lib/supabase/admin.ts) since
 * there's no signed-in user behind a cron invocation — guarded by
 * CRON_SECRET instead of a session (middleware.ts already leaves
 * /api/cron/* out of the signed-in gate for exactly this reason).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminSupabaseClient();

  // Runs on a Saturday; mondayOf(today) is this week's Monday, so +7
  // days is the Monday of the week being announced.
  const nextMonday = addDays(toISODate(mondayOf(new Date())), 7);
  const weekEnd = addDays(nextMonday, 7);

  const { data: planningOrgs, error: orgsError } = await supabase
    .from("organization_modules")
    .select("organization_id")
    .eq("module_key", "planning")
    .eq("enabled", true);
  if (orgsError) return NextResponse.json({ error: orgsError.message }, { status: 500 });

  let digestsSent = 0;
  for (const { organization_id } of planningOrgs ?? []) {
    const { data: entries, error: entriesError } = await supabase
      .from("planning_entries")
      .select("driver_id, tour_number, start_at, vehicles(registration)")
      .eq("organization_id", organization_id)
      .not("driver_id", "is", null)
      .gte("start_at", `${nextMonday}T00:00:00`)
      .lt("start_at", `${weekEnd}T00:00:00`)
      .order("start_at");
    if (entriesError || !entries || entries.length === 0) continue;

    const byDriver = new Map<string, DigestEntry[]>();
    for (const e of entries as unknown as (DigestEntry & { driver_id: string | null })[]) {
      if (!e.driver_id) continue;
      byDriver.set(e.driver_id, [...(byDriver.get(e.driver_id) ?? []), e]);
    }
    if (byDriver.size === 0) continue;

    const rows = Array.from(byDriver.entries()).map(([driverId, driverEntries]) => ({
      organization_id,
      type: "weekly_planning_digest",
      severity: "info",
      message: buildDigestMessage(driverEntries),
      related_table: "planning_entries",
      recipient_user_id: driverId,
    }));

    const { error: insertError } = await supabase.from("alerts").insert(rows);
    if (!insertError) digestsSent += rows.length;
  }

  return NextResponse.json({ digestsSent });
}
