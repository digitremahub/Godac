import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { estPresence, libelleEntreePlanning } from "@/lib/organization/poles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
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
function TourLine({ entry, day }: { entry: any; day: string }) {
  return (
    <Link href={"/planning/mine?view=day&anchor=" + day + "&entry=" + entry.id} className="flex min-w-0 items-center gap-2 rounded-md text-sm hover:bg-teal/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-ink">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[entry.status] ?? "bg-navy/30"}`} />
      <span className="shrink-0 font-semibold tabular-nums">{libelleEntreePlanning(entry)}</span>
      <span className="min-w-0 truncate text-navy/70">{entry.vehicles?.registration ?? "—"}</span>
      <span className="ml-auto shrink-0 tabular-nums text-navy/70">
        {timeFmt(entry.start_at)}
        {entry.end_at ? `–${timeFmt(entry.end_at)}` : ""}
      </span>
      <span className="sr-only">{STATUS_LABEL[entry.status] ?? entry.status}</span>
    </Link>
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
  searchParams: Promise<{ view?: string; anchor?: string; week?: string; entry?: string }>;
}) {
  const params = await searchParams;
  const g = await garderPage("moi.planning");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();


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
    .select("id, service_id, tour_number, start_at, end_at, status, vehicles(registration), services(name, depot_address)")
    .eq("driver_id", appUser.id)
    .gte("start_at", `${queryStart}T00:00:00`)
    .lt("start_at", `${queryEnd}T00:00:00`)
    .order("start_at");

  const selectedEntryInRange = params.entry ? ((entries ?? []) as any[]).find((e) => e.id === params.entry) ?? null : null;
  const { data: selectedEntryOutsideRange } = params.entry && !selectedEntryInRange
    ? await supabase.from("planning_entries")
        .select("id, service_id, tour_number, start_at, end_at, status, vehicles(registration), services(name, depot_address)")
        .eq("id", params.entry)
        .eq("driver_id", appUser.id)
        .maybeSingle()
    : { data: null };
  const selectedEntry = selectedEntryInRange ?? selectedEntryOutsideRange;
  const { data: routeDetails } = selectedEntry
    ? await supabase.from("tour_routes").select("id, notes, tour_route_villages(name, postal_code, notes, position)").eq("organization_id", appUser.organization_id).eq("tour_number", selectedEntry.tour_number).maybeSingle()
    : { data: null };

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
      <PageHeader title="Mon planning" description="Vos tournées prévues et effectuées, et vos horaires de présence si vous êtes dans un pôle bureau." />

      {selectedEntry && (
        <Card className="mb-5 border-teal-ink/25 bg-teal/[0.045]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-ink">Ma tournée affectée</p>
              <h2 className="mt-1 text-xl font-bold">Tournée n°{selectedEntry.tour_number}</h2>
              <p className="mt-1 text-sm text-navy/70">{new Date(selectedEntry.start_at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" })} · {timeFmt(selectedEntry.start_at)}{selectedEntry.end_at ? "–" + timeFmt(selectedEntry.end_at) : ""}</p>
            </div>
            <Link href={"/planning/mine?view=day&anchor=" + parisCalendarDate(selectedEntry.start_at)} className="btn-secondary !px-3 !py-1.5 text-sm">Fermer</Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/55">Service affecté</p>
              <p className="mt-1 font-semibold">{selectedEntry.services?.name ?? "Service non renseigné"}</p>
              <p className="mt-1 text-sm text-navy/70">{selectedEntry.services?.depot_address ?? "Adresse du service non renseignée"}</p>
              {selectedEntry.services?.depot_address && <a className="mt-2 inline-block text-sm text-teal-ink hover:underline" href={"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(selectedEntry.services.depot_address)} target="_blank" rel="noreferrer">Ouvrir l’adresse dans Maps ↗</a>}
            </div>
            <div className="rounded-xl bg-surface p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-navy/55">Véhicule</p>
              <p className="mt-1 font-semibold">{selectedEntry.vehicles?.registration ?? "Non affecté"}</p>
              <p className="mt-1 text-sm text-navy/70">Statut : {STATUS_LABEL[selectedEntry.status] ?? selectedEntry.status}</p>
            </div>
          </div>
          <div className="mt-4">
            <h3 className="font-semibold">Villages à desservir</h3>
            {((routeDetails as any)?.tour_route_villages ?? []).length ? (
              <ol className="mt-2 grid gap-2 sm:grid-cols-2">
                {[...((routeDetails as any).tour_route_villages as any[])].sort((a, b) => a.position - b.position).map((v, i) => (
                  <li key={v.id ?? v.name} className="rounded-lg bg-surface px-3 py-2 text-sm">
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-marine text-xs font-semibold text-teal">{i + 1}</span>
                    <span className="font-semibold">{v.name}</span>{v.postal_code ? <span className="ml-1 text-navy/60">({v.postal_code})</span> : null}
                    {v.notes && <p className="ml-8 mt-1 whitespace-pre-line text-xs text-navy/65">{v.notes}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-sm text-navy/60">Aucun village n’est encore renseigné pour cette tournée. Contactez votre responsable exploitation.</p>}
            {(routeDetails as any)?.notes && <p className="mt-3 whitespace-pre-line text-sm text-navy/70">{(routeDetails as any).notes}</p>}
          </div>
        </Card>
      )}

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
                  aria-label={`${Number(dayISO.slice(8, 10))} : ${dayEntries.length ? dayEntries.map((e) => (estPresence(e) ? "présence" : `tournée ${e.tour_number}`)).join(", ") : "repos"}`}
                  className={`flex min-h-[58px] flex-col gap-1 rounded-lg border p-1 sm:min-h-[78px] sm:p-1.5 ${
                    !inMonth ? "border-transparent opacity-40" : first ? "border-navy/10 bg-surface" : "border-navy/[0.06] bg-transparent"
                  } ${dayISO === today ? "ring-2 ring-teal-ink/50" : ""}`}
                >
                  <span className={`text-right text-xs font-semibold tabular-nums ${dayISO === today ? "text-teal-ink" : ""}`}>
                    {Number(dayISO.slice(8, 10))}
                  </span>
                  {first && (
                    <span className={`truncate rounded px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums ${STATUS_CHIP[first.status] ?? STATUS_CHIP.planned}`}>
                      {estPresence(first) ? "Présence" : first.tour_number}
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
              <DayStrip days={monthTourDays} toursByDay={toursByDay} today={today} dayHrefPrefix="/planning/mine?view=day&anchor=" />
            )}
          </Card>
        </div>
      ) : view === "week" ? (
        <Card>
          <DayStrip days={days} toursByDay={toursByDay} today={today} dayHrefPrefix="/planning/mine?view=day&anchor=" />
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
                          <TourLine entry={e} day={dayISO} />
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
