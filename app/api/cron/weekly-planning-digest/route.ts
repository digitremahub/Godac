import { NextResponse } from "next/server";
import { estPresence } from "@/lib/organization/poles";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addDays, parisCalendarDate } from "@/lib/planning/dates";
import { lundiDe } from "@/lib/planning/publication";
import { minuitParis } from "@/lib/ticpe/export";
import { estMasquee, servicesPublieesRecemment } from "@/lib/planning/semaines-auto";
import { semainesMasqueesDe } from "@/lib/planning/suivi-auto-serveur";

interface DigestEntry {
  tour_number: string;
  start_at: string;
  end_at?: string | null;
  status?: string | null;
  vehicles: { registration: string } | null;
}

function buildDigestMessage(entries: DigestEntry[]): string {
  const lines = entries.map((e) => {
    const d = new Date(e.start_at);
    const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    if (estPresence(e)) {
      const end = e.end_at ? new Date(e.end_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }) : null;
      return `${day} ${time}${end ? `–${end}` : ""} — présence`;
    }
    return `${day} ${time} — n°${e.tour_number}${e.vehicles ? ` (${e.vehicles.registration})` : ""}`;
  });
  return `Votre planning de la semaine prochaine :\n${lines.join("\n")}`;
}

/**
 * Vercel Cron, Fridays at 17:00 Europe/Paris (see vercel.json) — the weekly digest
 * n'annonce QUE les semaines PUBLIÉES (planning_validations) : une semaine non
 * publiée, y compris générée automatiquement le jeudi et pas encore confirmée,
 * ne part jamais aux chauffeurs ; un service publié depuis moins de 20 h (publication
 * manuelle, confirmation ou envoi automatique) n'est pas annoncé une seconde fois.
 * Replicates the paper/WhatsApp habit of handing each driver their
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

  const paris = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(new Date());
  if (paris !== "16" && paris !== "17") return NextResponse.json({ skipped: true, reason: "Outside the 16:00–17:00 Europe/Paris delivery window" });

  const supabase = createAdminSupabaseClient();

  // Runs on a Friday; the Monday of this week (Paris) + 7 days is the
  // Monday of the week being announced.
  const maintenant = new Date();
  const nextMonday = addDays(lundiDe(parisCalendarDate(maintenant.toISOString())), 7);
  const weekEnd = addDays(nextMonday, 7);

  const { data: planningOrgs, error: orgsError } = await supabase
    .from("organization_modules")
    .select("organization_id")
    .eq("module_key", "planning")
    .eq("enabled", true);
  if (orgsError) return NextResponse.json({ error: orgsError.message }, { status: 500 });

  let digestsSent = 0;
  for (const { organization_id } of planningOrgs ?? []) {
    // Services dont la semaine annoncée est publiée (planning_validations), et pas publiée à l'instant.
    const { data: validations } = await supabase.from("planning_validations").select("service_id, validated_at").eq("organization_id", organization_id).eq("week_start", nextMonday);
    const recents = servicesPublieesRecemment((validations ?? []) as { service_id: string; validated_at: string }[], maintenant);
    const publies = new Set(((validations ?? []) as { service_id: string }[]).map((v) => v.service_id).filter((id) => !recents.has(id)));
    if (publies.size === 0) continue;
    // Filet : une semaine générée automatiquement et pas encore publiée reste masquée (planning_semaines_auto).
    const masquees = await semainesMasqueesDe(supabase, organization_id);

    const { data: entries, error: entriesError } = await supabase
      .from("planning_entries")
      .select("driver_id, service_id, tour_number, start_at, end_at, status, vehicles(registration)")
      .eq("organization_id", organization_id)
      .in("service_id", [...publies])
      .not("driver_id", "is", null)
      .gte("start_at", minuitParis(nextMonday))
      .lt("start_at", minuitParis(weekEnd))
      .order("start_at");
    if (entriesError || !entries || entries.length === 0) continue;

    const byDriver = new Map<string, DigestEntry[]>();
    for (const e of entries as unknown as (DigestEntry & { driver_id: string | null; service_id: string })[]) {
      if (!e.driver_id || estMasquee(masquees, e)) continue;
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
