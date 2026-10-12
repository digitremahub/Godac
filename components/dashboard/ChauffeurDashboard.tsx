import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, StatTile, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { AlertList } from "@/components/alerts/AlertList";
import { ClockButton } from "@/components/time-clock/ClockButton";
import { TourHeroCard } from "@/components/dashboard/TourHeroCard";
import { PresenceCalendar } from "@/components/planning/PresenceCalendar";
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

  const [openTourRes, upcomingRes, recentEntriesRes, openClockRes, myMaintenanceRes, openAlertsRes, openAlertsCountRes, presenceRes] = await Promise.all([
    supabase
      .from("planning_entries")
      .select("id, tour_number, start_at, vehicles(registration)")
      .eq("driver_id", appUser.id)
      .eq("status", "in_progress")
      .maybeSingle(),
    planningEnabled
      ? supabase
          .from("planning_entries")
          .select("id, tour_number, start_at, vehicles(registration)")
          .eq("driver_id", appUser.id)
          .eq("status", "planned")
          .gte("start_at", now)
          .order("start_at", { ascending: true })
          .limit(4)
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
    supabase
      .from("planning_entries")
      .select("start_at, end_at, status")
      .eq("driver_id", appUser.id)
      .in("status", ["in_progress", "done"])
      .gte("start_at", presenceFrom)
      .lt("start_at", presenceTo),
  ]);

  const openTour = openTourRes.data as { id: string; tour_number: string; start_at: string; vehicles: { registration: string } | null } | null;
  const upcoming = (upcomingRes.data ?? []) as any as { id: string; tour_number: string; start_at: string; vehicles: { registration: string } | null }[];
  const recentEntries = (recentEntriesRes.data ?? []) as any[];
  const openAlerts = (openAlertsRes.data ?? []) as any[];
  const presence = presenceByDay((presenceRes.data ?? []) as { start_at: string; end_at: string | null; status: string }[], month);

  return (
    <div>
      <PageHeader title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`} description="Votre journée en un coup d'œil." />

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
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg">Mon planning cette semaine</h2>
              <Link href="/planning/mine" className="text-sm text-teal-ink hover:underline">
                Voir tout
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-navy/60">Aucune tournée planifiée à venir.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {upcoming.map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded-xl bg-navy/[0.035] px-3.5 py-2.5">
                    <span>
                      n°{t.tour_number} {t.vehicles ? `— ${t.vehicles.registration}` : ""}
                    </span>
                    <span className="text-xs text-navy/60">
                      {new Date(t.start_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
