import { NextResponse } from "next/server";
import { estPresence } from "@/lib/organization/poles";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

interface Entry {
  driver_id: string;
  tour_number: string;
  start_at: string;
  end_at: string | null;
  vehicles: { registration: string } | null;
}

function parisDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function shiftDay(iso: string, days: number) {
  const parts = iso.split("-").map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const parisHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(now);
  if (parisHour !== "16" && parisHour !== "17") return NextResponse.json({ skipped: true, reason: "Outside the 16:00–17:00 Europe/Paris delivery window" });

  const tomorrow = shiftDay(parisDate(now), 1);
  const dayAfter = shiftDay(tomorrow, 1);
  const supabase = createAdminSupabaseClient();
  const { data: orgs, error: orgError } = await supabase.from("organization_modules")
    .select("organization_id").eq("module_key", "planning").eq("enabled", true);
  if (orgError) return NextResponse.json({ error: orgError.message }, { status: 500 });

  let remindersSent = 0;
  for (const { organization_id } of orgs ?? []) {
    const { data, error } = await supabase.from("planning_entries")
      .select("driver_id, tour_number, start_at, end_at, status, vehicles(registration)")
      .eq("organization_id", organization_id).not("driver_id", "is", null)
      .gte("start_at", `${tomorrow}T00:00:00`).lt("start_at", `${dayAfter}T00:00:00`)
      .in("status", ["planned", "in_progress"]).order("start_at");
    if (error || !data?.length) continue;
    // Pas de rappel à un salarié en arrêt de travail demain (arrêts non refusés ; table absente : aucun).
    const { data: arrets } = await supabase.from("work_stoppages").select("*")
      .eq("organization_id", organization_id).lte("start_date", tomorrow).gte("end_date", tomorrow);
    const enArret = new Set(((arrets ?? []) as { user_id: string; status?: string }[]).filter((a) => a.status !== "refuse").map((a) => a.user_id));
    // ... ni à un salarié en congé approuvé demain (affectation restée posée : le planning la signale à l'encadrement).
    const { data: conges } = await supabase.from("leave_requests").select("driver_id")
      .eq("organization_id", organization_id).eq("status", "approved").lte("start_date", tomorrow).gte("end_date", tomorrow);
    for (const c of (conges ?? []) as { driver_id: string }[]) enArret.add(c.driver_id);
    const byDriver = new Map<string, Entry[]>();
    for (const row of data as unknown as Entry[]) if (!enArret.has(row.driver_id)) byDriver.set(row.driver_id, [...(byDriver.get(row.driver_id) ?? []), row]);
    const alerts = Array.from(byDriver.entries()).map(([driverId, entries]) => {
      const lines = entries.map(e => {
        const start = new Date(e.start_at);
        const time = start.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
        if (estPresence(e)) {
          const end = e.end_at ? new Date(e.end_at).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : null;
          return `${time}${end ? `–${end}` : ""} — présence`;
        }
        return `${time} — tournée n°${e.tour_number}${e.vehicles ? ` (${e.vehicles.registration})` : ""}`;
      });
      return { organization_id, type: "planning_assignment", severity: "info", message: `Rappel de votre planning pour demain (${new Date(`${tomorrow}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" })}) :\n${lines.join("\n")}`, related_table: "planning_entries", recipient_user_id: driverId };
    });
    if (alerts.length) {
      const { error: insertError } = await supabase.from("alerts").insert(alerts);
      if (!insertError) remindersSent += alerts.length;
    }
  }
  return NextResponse.json({ remindersSent, date: tomorrow });
}
