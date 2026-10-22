import Link from "next/link";
import { Card } from "@/components/ui";
import { addMonths, monthCalendarDays, parisCalendarDate } from "@/lib/planning/dates";
import type { PresenceDay } from "@/lib/planning/presence";

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/**
 * Two stacked ticks, read like a messaging receipt: top = morning
 * departure, bottom = evening return. Green once recorded, grey
 * otherwise — no letters, the position says which is which.
 */
function Ticks({ morning, evening }: { morning: boolean; evening: boolean }) {
  const on = "stroke-success";
  const off = "stroke-navy/20";
  return (
    <svg viewBox="0 0 22 20" aria-hidden="true" className="h-6 w-[26px] sm:h-7 sm:w-[30px]" fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,5.5 6.5,9 13,2.5" className={morning ? on : off} />
      <polyline points="8,12.5 11.5,16 18,9.5" className={evening ? on : off} />
    </svg>
  );
}

/**
 * Month grid of the driver's own presence — top tick = tour started
 * that morning, bottom tick = return recorded that evening. No hours on purpose: the
 * driver checks *that* each day is recorded, payroll handles the rest.
 */
export function PresenceCalendar({
  month,
  days,
  mornings,
  evenings,
  hrefForMonth,
}: {
  month: string;
  days: Map<string, PresenceDay>;
  mornings: number;
  evenings: number;
  hrefForMonth: (month: string) => string;
}) {
  const grid = monthCalendarDays(month);
  const today = parisCalendarDate(new Date().toISOString());
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  const isCurrentMonth = today.startsWith(month);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2>Mes présences</h2>
          <p className="mt-1 text-sm text-navy/65">
            {mornings} départ{mornings > 1 ? "s" : ""} et {evenings} retour{evenings > 1 ? "s" : ""} enregistrés ce mois-ci.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={hrefForMonth(addMonths(month, -1))} className="btn-ghost !px-2.5 !py-2" aria-label="Mois précédent" scroll={false}>
            <span aria-hidden="true">‹</span>
          </Link>
          <span className="min-w-[8.5rem] text-center text-sm font-semibold capitalize">{label}</span>
          {isCurrentMonth ? (
            <span className="w-10" />
          ) : (
            <Link href={hrefForMonth(addMonths(month, 1))} className="btn-ghost !px-2.5 !py-2" aria-label="Mois suivant" scroll={false}>
              <span aria-hidden="true">›</span>
            </Link>
          )}
        </div>
      </div>

      <div role="grid" aria-label={`Présences — ${label}`} className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {DAY_LABELS.map((d) => (
          <div key={d} role="columnheader" className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-navy/60">
            {d}
          </div>
        ))}
        {grid.map((day) => {
          const inMonth = day.startsWith(month);
          if (!inMonth) return <div key={day} aria-hidden="true" />;
          const p = days.get(day);
          const full = Boolean(p?.morning && p?.evening);
          const future = day > today;
          return (
            <div
              key={day}
              role="gridcell"
              aria-label={`${Number(day.slice(8))} : ${p?.morning ? "départ enregistré" : "pas de départ"}, ${p?.evening ? "retour enregistré" : "pas de retour"}`}
              className={`flex min-h-[64px] flex-col justify-between rounded-lg border p-1.5 sm:p-2 ${
                full ? "border-success/30 bg-success/[0.06]" : future ? "border-navy/[0.06] bg-transparent" : "border-navy/[0.08] bg-surface"
              } ${day === today ? "ring-2 ring-teal-ink/40" : ""}`}
            >
              <span className={`text-xs font-semibold tabular-nums ${future ? "text-navy/40" : "text-navy"}`}>
                {Number(day.slice(8))}
              </span>
              {!future && (
                <span className="self-end">
                  <Ticks morning={Boolean(p?.morning)} evening={Boolean(p?.evening)} />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
