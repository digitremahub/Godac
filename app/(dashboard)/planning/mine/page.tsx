import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { mondayOf, toISODate, addDays, firstOfMonth, addMonths, todayISO, monthCalendarDays } from "@/lib/planning/dates";

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MAX_VISIBLE_PER_DAY = 3;

const STATUS_BADGE: Record<string, string> = {
  planned: "badge-neutral",
  in_progress: "badge-gold",
  done: "badge-teal",
};
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

  const view: ViewMode = params.view === "day" || params.view === "month" ? params.view : "week";
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

  const dayCount = Math.round((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000);
  const days = Array.from({ length: dayCount }, (_, i) => addDays(start, i));

  return (
    <div>
      <PageHeader title="Mon planning" description="Vos tournées prévues et effectuées." />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["day", "week", "month"] as const).map((v) => (
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
        <span className="text-sm capitalize text-navy/60">{label}</span>
        <Link href={`/planning/mine?view=${view}&anchor=${nextAnchor}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          Suiv. →
        </Link>
      </div>

      {view === "month" && calendarDays ? (
        <div className="grid grid-cols-7 gap-1.5 text-xs">
          {DAY_LABELS.map((l) => (
            <div key={l} className="px-1 text-navy/40">
              {l}
            </div>
          ))}
          {calendarDays.map((dayISO) => {
            const dayEntries = (entries ?? []).filter((e: any) => e.start_at.slice(0, 10) === dayISO);
            const inMonth = dayISO.slice(0, 7) === anchor.slice(0, 7);
            return (
              <Link
                key={dayISO}
                href={`/planning/mine?view=day&anchor=${dayISO}`}
                className={`flex min-h-[72px] flex-col gap-0.5 rounded-lg border border-navy/10 p-1.5 ${
                  inMonth ? "bg-white" : "bg-navy/5 text-navy/30"
                }`}
              >
                <span className="font-medium">{Number(dayISO.slice(8, 10))}</span>
                {dayEntries.slice(0, MAX_VISIBLE_PER_DAY).map((e: any) => (
                  <span
                    key={e.id}
                    className={`truncate rounded px-1 text-[10px] ${
                      e.status === "done" ? "bg-teal/15 text-navy/70" : e.status === "in_progress" ? "bg-gold/20 text-navy/70" : "bg-navy/10 text-navy/60"
                    }`}
                  >
                    n°{e.tour_number}
                  </span>
                ))}
                {dayEntries.length > MAX_VISIBLE_PER_DAY && (
                  <span className="text-[10px] text-navy/40">+{dayEntries.length - MAX_VISIBLE_PER_DAY}</span>
                )}
              </Link>
            );
          })}
        </div>
      ) : (entries ?? []).length === 0 ? (
        <EmptyState title="Aucune tournée sur cette période" description="Rien ne vous est encore assigné." />
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((dayISO) => {
            const dayEntries = (entries ?? []).filter((e: any) => e.start_at.slice(0, 10) === dayISO);
            if (dayEntries.length === 0) return null;
            return (
              <div key={dayISO}>
                <p className="mb-2 text-sm font-medium capitalize text-navy/60">
                  {new Date(`${dayISO}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" })}
                </p>
                <div className="flex flex-col gap-2">
                  {dayEntries.map((entry: any) => (
                    <Card key={entry.id} className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          Tournée n°{entry.tour_number} {entry.services ? `· ${entry.services.name}` : ""}
                        </p>
                        <p className="text-sm text-navy/60">{entry.vehicles?.registration ?? "Véhicule non précisé"}</p>
                        <p className="text-xs text-navy/40">
                          {new Date(entry.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}
                          {entry.end_at
                            ? ` → ${new Date(entry.end_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}`
                            : ""}
                        </p>
                      </div>
                      <span className={STATUS_BADGE[entry.status] ?? "badge-neutral"}>
                        {STATUS_LABEL[entry.status] ?? entry.status}
                      </span>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
