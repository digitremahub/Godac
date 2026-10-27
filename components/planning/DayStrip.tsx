"use client";

import { libelleEntreePlanning } from "@/lib/organization/poles";
import Link from "next/link";
import { useEffect, useRef } from "react";

export interface StripTour {
  id: string;
  tour_number: string;
  start_at: string;
  end_at: string | null;
  status: string;
  registration: string | null;
  /** « fusionnée avec 105 » : tournée hôte d'une fusion (lib/planning/fusion-verrou.ts). */
  fusion?: string | null;
}

const STATUS_BAR: Record<string, string> = {
  planned: "bg-navy/25",
  in_progress: "bg-gold",
  done: "bg-teal",
};

const timeFmt = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/**
 * Days laid out left to right, one column per day, swiped sideways on a
 * phone. Opens scrolled to today so the driver lands on what matters.
 */
export function DayStrip({
  days,
  toursByDay,
  today,
  dayHrefPrefix,
  emptyLabel = "Repos",
}: {
  days: string[];
  toursByDay: Record<string, StripTour[]>;
  today: string;
  /** Each day links to `${dayHrefPrefix}${day}` — a string, not a callback: this is a Client Component fed by Server Components. */
  dayHrefPrefix?: string;
  emptyLabel?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>("[data-today]");
    if (el && target && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = target.offsetLeft - el.offsetLeft - 8;
    }
  }, []);

  return (
    <div
      ref={scroller}
      className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]"
    >
      {days.map((day) => {
        const tours = toursByDay[day] ?? [];
        const isToday = day === today;
        const past = day < today;
        const d = new Date(`${day}T12:00:00Z`);
        const header = (
          <div className="flex items-baseline justify-between gap-1">
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? "text-teal-ink" : "text-navy/55"}`}>
              {d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" }).replace(".", "")}
            </span>
            <span className={`font-display text-lg font-bold tabular-nums leading-none ${isToday ? "text-teal-ink" : ""}`}>
              {d.getUTCDate()}
            </span>
          </div>
        );
        const body = (
          <div className="mt-2 flex flex-1 flex-col gap-1.5">
            {tours.length === 0 ? (
              <span className="text-xs text-navy/45">{emptyLabel}</span>
            ) : (
              tours.map((t) => (
                <div key={t.id} className="flex overflow-hidden rounded-lg bg-navy/[0.045]">
                  <span aria-hidden="true" className={`w-1 shrink-0 ${STATUS_BAR[t.status] ?? STATUS_BAR.planned}`} />
                  <div className="min-w-0 px-2 py-1.5">
                    <p className="text-sm font-semibold tabular-nums leading-tight">{libelleEntreePlanning(t)}</p>
                    <p className="text-xs tabular-nums text-navy/70">
                      {timeFmt(t.start_at)}
                      {t.end_at ? `–${timeFmt(t.end_at)}` : ""}
                    </p>
                    {t.fusion && <p className="text-[11px] font-semibold text-navy/70">{t.fusion}</p>}
                    {t.registration && <p className="truncate text-[11px] text-navy/55">{t.registration}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        );
        const className = `flex min-h-[8.5rem] w-[7.25rem] shrink-0 snap-start flex-col rounded-xl border p-2.5 sm:w-auto sm:min-w-[7.25rem] sm:flex-1 ${
          isToday ? "border-teal-ink/40 bg-teal/[0.07]" : "border-navy/[0.08] bg-surface"
        } ${past && !isToday ? "opacity-70" : ""}`;
        return dayHrefPrefix ? (
          <Link key={day} href={`${dayHrefPrefix}${day}`} data-today={isToday || undefined} className={`${className} transition-colors hover:border-navy/20`}>
            {header}
            {body}
          </Link>
        ) : (
          <div key={day} data-today={isToday || undefined} className={className}>
            {header}
            {body}
          </div>
        );
      })}
    </div>
  );
}
