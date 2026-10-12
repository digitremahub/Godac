import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { DayStrip, type StripTour } from "@/components/planning/DayStrip";
import { mondayOf, toISODate, addDays, firstOfMonth, addMonths, todayISO, monthCalendarDays, parisCalendarDate } from "@/lib/planning/dates";

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const STATUS_DOT: Record<string, string> = {
  planned: "bg-navy/30",
  in_progress: "bg-gold",
  done: "bg-teal",
};
const STATUS_CHIP: Record<string, string> = {
  planned: "bg-navy/[0.07] text-navy",
  in_progress: "bg-gold/25 text-navy",
  done: "bg-teal/20 text-navy",
};

const timeFmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** One tour on one line: status dot, n°, truck, hours — readable at a glance on a phone. */
function TourLine({ entry }: { entry: any }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[entry.status] ?? "bg-navy/30"}`} />
      <span className="shrink-0 font-semibold tabular-nums">n°{entry.tour_number}</span>
      <span className="min-w-0 truncate text-navy/70">{entry.vehicles?.registration ?? "—"}</span>
      <span className="ml-auto shrink-0 tabular-nums text-navy/70">
        {timeFmt(entry.start_at)}
        {entry.end_at ? `–${timeFmt(entry.end_at)}` : ""}
      </span>
      <span className="sr-only">{STATUS_LABEL[entry.status] ?? entry.status}</span>
    </div>
  );
}
const STATUS_LABEL: Record<string, string> = {
  planned: "Prévue",
  in_progress: "En cours",
  done: "Terminée",
};

type ViewMode = "day" | "week" | "month";

function windowFor(view: ViewMode, anchor: string): { start: string; end: string; prevAnchor: string; nextAnchor: string; label: string } {
  if (view === "day") {
    return {
      start: anchor,
      end: addDays(anchor, 1),
      prevAnchor: addDays(anchor, -1),
      nextAnchor: addDays(anchor, 1),
      label: new Date(`${anchor}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }),
    };
  }
  if (view === "month") {
    const monthStr = anchor.slice(0, 7);
    const start = firstOfMonth(monthStr);
    return {
      start,
      end: firstOfMonth(addMonths(monthStr, 1)),
      prevAnchor: `${addMonths(monthStr, -1)}-01`,
      nextAnchor: `${addMonths(monthStr, 1)}-01`,
      label: new Date(`${start}T00:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }),
    };
  }
  const start = toISODate(mondayOf(new Date(`${anchor}T00:00:00Z`)));
  return {
    start,
    end: addDays(start, 7),
    prevAnchor: addDays(anchor, -7),
    nextAnchor: addDays(anchor, 7),
    label: `Semaine du ${start.split("-").reverse().join("/")}`,
  };
}

/**
 * Read-only, own-tours-only counterpart to the manager-facing
 * /planning grid — a chauffeur has no reason to see other drivers'
 * assignments or drag anything around, just "what am I doing". RLS
 * (planning_entries: read within org, driver_id =
 * current_app_user_id()) already scopes this correctly for any role,
 * so no new policy is needed. Day/week/month are the same read with a
 * different window, not three different queries.
 */
export default async function MyPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; anchor?: string; week?: string }>;
}) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const planningEnabled = await isModuleEnabled(supabase, appUser.organization_id, "planning");
  if (!planningEnabled) {
    return (
      <EmptyState
        title="Module Planning non activé"
        description="Contactez votre gestionnaire pour l'activer."
      />
    );
  }

  // Month first: the driver's question is « quand je travaille ce mois-ci ».
  const view: ViewMode = params.view === "day" || params.view === "week" ? params.view : "month";
  // `week` is the old param name (still linked to from elsewhere); `anchor` is the new one.
  const anchorInput = params.anchor ?? params.week;
  const anchor = anchorInput && !Number.isNaN(Date.parse(anchorInput)) ? toISODate(new Date(anchorInput)) : todayISO();
  const { start, end, prevAnchor, nextAnchor, label } = windowFor(view, anchor);

  // Month view's calendar grid shows leading/trailing days from
  // adjacent months (to fill out the 7-column grid) — read those
  // days' entries too, same as the manager-facing /planning month
  // view, so a tour on e.g. the last Monday of the previous month
  // isn't silently missing from the grid.
  const calendarDays = view === "month" ? monthCalendarDays(anchor.slice(0, 7)) : null;
  const queryStart = calendarDays ? (calendarDays[0] ?? start) : start;
  const queryEnd = calendarDays ? addDays(calendarDays[calendarDays.length - 1] ?? end, 1) : end;

  const { data: entries } = await supabase
    .from("planning_entries")
    .select("id, tour_number, start_at, end_at, status, vehicles(registration), services(name)")
    .eq("driver_id", appUser.id)
    .gte("start_at", `${queryStart}T00:00:00`)
    .lt("start_at", `${queryEnd}T00:00:00`)
    .order("start_at");

  const entriesByDay = new Map<string, any[]>();
  for (const e of (entries ?? []) as any[]) {
    const d = parisCalendarDate(e.start_at);
    entriesByDay.set(d, [...(entriesByDay.get(d) ?? []), e]);
  }
  const today = parisCalendarDate(new Date().toISOString());
  const toursByDay: Record<string, StripTour[]> = {};
  for (const [d, list] of entriesByDay) {
    toursByDay[d] = list.map((e) => ({
      id: e.id,
      tour_number: e.tour_number,
      start_at: e.start_at,
      end_at: e.end_at,
      status: e.status,
      registration: e.vehicles?.registration ?? null,
    }));
  }
  const monthTourDays = Object.keys(toursByDay)
    .filter((d) => d.startsWith(anchor.slice(0, 7)))
    .sort();

  const dayCount = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000);
  const days = Array.from({ length: dayCount }, (_, i) => addDays(start, i));

  return (
    <div>
      <PageHeader title="Mon planning" description="Vos tournées prévues et effectuées." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["month", "week", "day"] as const).map((v) => (
          <Link
            key={v}
            href={`/planning/mine?view=${v}&anchor=${anchor}`}
            className={v === view ? "btn-primary !px-3 !py-1.5 text-sm" : "btn-secondary !px-3 !py-1.5 text-sm"}
          >
            {v === "day" ? "Jour" : v === "week" ? "Semaine" : "Mois"}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <Link href={`/planning/mine?view=${view}&anchor=${prevAnchor}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          ← Préc.
        </Link>
        <span className="text-sm capitalize text-navy/70">{label}</span>
        <Link href={`/planning/mine?view=${view}&anchor=${nextAnchor}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          Suiv. →
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy/65">
        {(["planned", "in_progress", "done"] as const).map((st) => (
          <span key={st} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[st]}`} />
            {STATUS_LABEL[st]}
          </span>
        ))}
      </div>

      {view === "month" && calendarDays ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {DAY_LABELS.map((l) => (
              <div key={l} className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-navy/60">
                {l}
              </div>
            ))}
            {calendarDays.map((dayISO) => {
              const dayEntries = entriesByDay.get(dayISO) ?? [];
              const inMonth = dayISO.slice(0, 7) === anchor.slice(0, 7);
              const first = dayEntries[0];
              return (
                <Link
                  key={dayISO}
                  href={`/planning/mine?view=day&anchor=${dayISO}`}
                  aria-label={`${Number(dayISO.slice(8, 10))} : ${dayEntries.length ? dayEntries.map((e) => `tournée ${e.tour_number}`).join(", ") : "repos"}`}
                  className={`flex min-h-[58px] flex-col gap-1 rounded-lg border p-1 sm:min-h-[78px] sm:p-1.5 ${
                    !inMonth ? "border-transparent opacity-40" : first ? "border-navy/10 bg-surface" : "border-navy/[0.06] bg-transparent"
                  } ${dayISO === today ? "ring-2 ring-teal-ink/50" : ""}`}
                >
                  <span className={`text-right text-xs font-semibold tabular-nums ${dayISO === today ? "text-teal-ink" : ""}`}>
                    {Number(dayISO.slice(8, 10))}
                  </span>
                  {first && (
                    <span className={`truncate rounded px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums ${STATUS_CHIP[first.status] ?? STATUS_CHIP.planned}`}>
                      {first.tour_number}
                    </span>
                  )}
                  {dayEntries.length > 1 && <span className="text-center text-[11px] text-navy/60">+{dayEntries.length - 1}</span>}
                </Link>
              );
            })}
          </div>

          <Card>
            <h2 className="mb-3">Tournées du mois</h2>
            {monthTourDays.length === 0 ? (
              <p className="text-sm text-navy/65">Aucune tournée ce mois-ci.</p>
            ) : (
              <DayStrip days={monthTourDays} toursByDay={toursByDay} today={today} hrefForDay={(d) => `/planning/mine?view=day&anchor=${d}`} />
            )}
          </Card>
        </div>
      ) : view === "week" ? (
        <Card>
          <DayStrip days={days} toursByDay={toursByDay} today={today} hrefForDay={(d) => `/planning/mine?view=day&anchor=${d}`} />
        </Card>
      ) : (
        <Card className="!p-0">
          <ul className="divide-y divide-navy/[0.07]">
            {days.map((dayISO) => {
              const dayEntries = entriesByDay.get(dayISO) ?? [];
              return (
                <li key={dayISO} className={`flex gap-3 px-4 py-3 sm:px-5 ${dayISO === today ? "bg-teal/[0.06]" : ""}`}>
                  <span className="w-16 shrink-0 text-sm font-semibold capitalize tabular-nums">
                    {new Date(`${dayISO}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: view === "day" ? "long" : undefined, timeZone: "UTC" })}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {dayEntries.length === 0 ? (
                      <span className="text-sm text-navy/50">Repos</span>
                    ) : (
                      dayEntries.map((e) => (
                        <div key={e.id} className="flex flex-col">
                          <TourLine entry={e} />
                          {e.services?.name && <span className="pl-[18px] text-xs text-navy/60">{e.services.name}</span>}
                        </div>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
