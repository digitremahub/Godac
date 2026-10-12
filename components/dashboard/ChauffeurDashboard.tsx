import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { AlertList } from "@/components/alerts/AlertList";
import { ClockButton } from "@/components/time-clock/ClockButton";
import { TourHeroCard } from "@/components/dashboard/TourHeroCard";
import { AssistedClock } from "@/components/time-clock/AssistedClock";
import { PresenceCalendar } from "@/components/planning/PresenceCalendar";
import { DayStrip, type StripTour } from "@/components/planning/DayStrip";
import { presenceByDay } from "@/lib/planning/presence";
import { addDays, addMonths, firstOfMonth, parisCalendarDate } from "@/lib/planning/dates";
import type { AppUser } from "@/lib/auth/session";

/**
 * The driver's own day at a glance: start/end the tour (the one action
 * that matters most, so it sits first and large), then the week ahead,
 * the latest fuel entries, and anything needing their attention —
 * never the fleet-wide numbers a manager cares about.
 */
export async function ChauffeurDashboard({
  appUser,
  enabledModules,
  presenceMonth,
}: {
  appUser: AppUser;
  enabledModules: string[];
  /** "YYYY-MM" from ?presence= — defaults to the current Paris month. */
  presenceMonth?: string;
}) {
  const supabase = await createServerSupabaseClient();
  const planningEnabled = enabledModules.includes("planning");
  const timeClockEnabled = enabledModules.includes("time_clock");
  const maintenanceEnabled = enabledModules.includes("maintenance_requests");

  const now = new Date().toISOString();
  const thisMonth = parisCalendarDate(now).slice(0, 7);
  const month = presenceMonth && /^\d{4}-\d{2}$/.test(presenceMonth) && presenceMonth <= thisMonth ? presenceMonth : thisMonth;
  // Widened by a day on each side: tours are stored as UTC instants
  // and only grouped by Paris calendar day in presenceByDay, which also
  // drops anything that lands outside the month.
  const presenceFrom = `${addDays(firstOfMonth(month), -1)}T00:00:00Z`;
  const presenceTo = `${addDays(firstOfMonth(addMonths(month, 1)), 1)}T00:00:00Z`;

  const todayParis = parisCalendarDate(now);
  const weekStart = addDays(todayParis, -((new Date(`${todayParis}T12:00:00Z`).getUTCDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const [openTourRes, upcomingRes, recentEntriesRes, openClockRes, myMaintenanceRes, openAlertsRes, openAlertsCountRes, autoClockRes, presenceRes] = await Promise.all([
    supabase
      .from("planning_entries")
      .select("id, tour_number, start_at, vehicles(registration)")
      .eq("driver_id", appUser.id)
      .eq("status", "in_progress")
      .maybeSingle(),
    planningEnabled
      ? supabase
          .from("planning_entries")
          .select("id, tour_number, start_at, end_at, status, vehicles(registration)")
          .eq("driver_id", appUser.id)
          // A day of margin each side: rows are UTC instants, grouped by Paris day below.
          .gte("start_at", `${addDays(weekStart, -1)}T00:00:00Z`)
          .lt("start_at", `${addDays(weekStart, 8)}T00:00:00Z`)
          .order("start_at", { ascending: true })
      : Promise.resolve({ data: null }),
    supabase
      .from("fuel_entries")
      .select("id, occurred_at, liters, unit_price, status, vehicles(registration)")
      .eq("driver_id", appUser.id)
      .order("occurred_at", { ascending: false })
      .limit(5),
    timeClockEnabled
      ? supabase.from("time_clock_entries").select("id").eq("user_id", appUser.id).is("clocked_out_at", null).maybeSingle()
      : Promise.resolve({ data: null }),
    maintenanceEnabled
      ? supabase
          .from("vehicle_interventions")
          .select("id", { count: "exact", head: true })
          .eq("requested_by", appUser.id)
          .not("status", "in", "(done,cancelled)")
      : Promise.resolve({ count: null }),
    supabase
      .from("alerts")
      .select("id, type, severity, message, status, notified_at, created_at, related_table, related_id")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    timeClockEnabled
      ? supabase.from("organizations").select("auto_clock_enabled").eq("id", appUser.organization_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("planning_entries")
      .select("start_at, end_at, status")
      .eq("driver_id", appUser.id)
      .in("status", ["in_progress", "done"])
      .gte("start_at", presenceFrom)
      .lt("start_at", presenceTo),
  ]);

  const openTour = openTourRes.data as { id: string; tour_number: string; start_at: string; vehicles: { registration: string } | null } | null;

  const weekToursByDay: Record<string, StripTour[]> = {};
  for (const t of (upcomingRes.data ?? []) as any[]) {
    const day = parisCalendarDate(t.start_at);
    if (!weekDays.includes(day)) continue;
    (weekToursByDay[day] ??= []).push({
      id: t.id,
      tour_number: t.tour_number,
      start_at: t.start_at,
      end_at: t.end_at,
      status: t.status,
      registration: t.vehicles?.registration ?? null,
    });
  }
  const recentEntries = (recentEntriesRes.data ?? []) as any[];
  const openAlerts = (openAlertsRes.data ?? []) as any[];
  const presence = presenceByDay((presenceRes.data ?? []) as { start_at: string; end_at: string | null; status: string }[], month);

  // Team leader(s) of the driver's service(s), and the villages of
  // today's tour (the one in progress, else today's planned one).
  const todayTourNumber = openTour?.tour_number ?? weekToursByDay[todayParis]?.[0]?.tour_number ?? null;
  const [{ data: myServiceRows }, { data: todayRoute }] = await Promise.all([
    supabase.from("user_services").select("services(id, name, team_leader_name, team_leader_phone, team_leader_email)").eq("user_id", appUser.id),
    todayTourNumber && planningEnabled
      ? supabase.from("tour_routes").select("tour_number, notes, tour_route_villages(name, postal_code, notes, position)").eq("tour_number", todayTourNumber).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const teamLeaders = ((myServiceRows ?? []) as any[])
    .map((r) => r.services)
    .filter((sv) => sv && (sv.team_leader_name || sv.team_leader_phone || sv.team_leader_email));
  const todayVillages = (((todayRoute as any)?.tour_route_villages ?? []) as any[]).sort((a, b) => a.position - b.position);

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Votre journée en un coup d'œil." />
      {timeClockEnabled && (autoClockRes.data as { auto_clock_enabled?: boolean } | null)?.auto_clock_enabled && (
        <AssistedClock hasOpenTour={Boolean(openTour)} />
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TourHeroCard openTour={openTour} showPlanningLink={planningEnabled} />

        <div className="flex flex-col gap-4">
          <QrCodeBadge type="driver" id={appUser.id} title={appUser.full_name} subtitle="Mon badge chauffeur — à présenter à la pompe" />
          {timeClockEnabled && <ClockButton clockedIn={Boolean(openClockRes.data)} />}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile label="Alertes ouvertes" value={String(openAlertsCountRes.count ?? 0)} accent={openAlertsCountRes.count ? "orange" : "teal"} />
        {maintenanceEnabled && (
          <Link href="/maintenance" className="block">
            <StatTile label="Mes demandes d'entretien en cours" value={String(myMaintenanceRes.count ?? 0)} accent="gold" />
          </Link>
        )}
      </div>

      {(teamLeaders.length > 0 || todayVillages.length > 0) && (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {todayVillages.length > 0 && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg">Villages de la tournée {todayTourNumber}</h2>
                <Link href="/tours/routes" className="text-sm text-teal-ink hover:underline">
                  Détails
                </Link>
              </div>
              <ol className="flex flex-wrap gap-1.5">
                {todayVillages.map((v: any, i: number) => (
                  <li key={i} className="flex items-center gap-1.5 rounded-full bg-navy/[0.045] py-1 pl-1 pr-3 text-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-marine text-[11px] font-semibold tabular-nums text-teal">{i + 1}</span>
                    {v.name}
                  </li>
                ))}
              </ol>
              {(todayRoute as any)?.notes && <p className="mt-3 whitespace-pre-line text-sm text-navy/70">{(todayRoute as any).notes}</p>}
            </Card>
          )}
          {teamLeaders.map((sv: any) => (
            <Card key={sv.id}>
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/55">Mon chef d&apos;équipe · {sv.name}</p>
              <p className="mt-1 font-display text-lg font-bold">{sv.team_leader_name ?? "—"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {sv.team_leader_phone && (
                  <a href={`tel:${sv.team_leader_phone.replace(/\s+/g, "")}`} className="btn-primary !py-2 text-sm">
                    Appeler · {sv.team_leader_phone}
                  </a>
                )}
                {sv.team_leader_email && (
                  <a href={`mailto:${sv.team_leader_email}`} className="btn-secondary !py-2 text-sm">
                    E-mail
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-6">
        <PresenceCalendar
          month={month}
          days={presence.days}
          mornings={presence.mornings}
          evenings={presence.evenings}
          hrefForMonth={(m) => (m === thisMonth ? "/dashboard" : `/dashboard?presence=${m}`)}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {planningEnabled && (
          <Card className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg">Mon planning cette semaine</h2>
              <Link href="/planning/mine?view=week" className="text-sm text-teal-ink hover:underline">
                Voir tout
              </Link>
            </div>
            <DayStrip
              days={weekDays}
              toursByDay={weekToursByDay}
              today={todayParis}
              hrefForDay={(d) => `/planning/mine?view=day&anchor=${d}`}
            />
          </Card>
        )}

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg">Mes derniers ravitaillements</h2>
            <Link href="/fuel" className="text-sm text-teal-ink hover:underline">
              Voir tout
            </Link>
          </div>
          {recentEntries.length === 0 ? (
            <EmptyState title="Aucun ravitaillement enregistré" />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {recentEntries.map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
                  <span>
                    {e.vehicles?.registration ?? "—"} · {e.liters ? `${e.liters} L` : "—"}
                  </span>
                  <span className="text-xs text-navy/60">{new Date(e.occurred_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {openAlerts.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-lg">Notifications</h2>
          <AlertList alerts={openAlerts} viewerRole={appUser.role} />
        </div>
      )}
    </div>
  );
}
