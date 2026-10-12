import Link from "next/link";
import { Card } from "@/components/ui";
import { IconCheck } from "@/components/layout/icons";
import { addMonths, monthCalendarDays, parisCalendarDate } from "@/lib/planning/dates";
import type { PresenceDay } from "@/lib/planning/presence";

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function Mark({ on, letter, label }: { on: boolean; letter: string; label: string }) {
  return (
    <span
      title={`${label} : ${on ? "validé" : "non enregistré"}`}
      className={`flex items-center gap-0.5 text-[11px] font-semibold ${on ? "text-teal-ink" : "text-navy/35"}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full ${on ? "bg-teal text-navy" : "ring-1 ring-inset ring-navy/20"}`}
      >
        {on && <IconCheck className="h-2.5 w-2.5" />}
      </span>
      {letter}
    </span>
  );
}

/**
 * Month grid of the driver's own presence — M = tour started that
 * morning, S = return recorded that evening. No hours on purpose: the
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

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy/65">
        <span>
          <strong className="text-navy">M</strong> départ du matin
        </span>
        <span>
          <strong className="text-navy">S</strong> retour du soir
        </span>
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
                full ? "border-teal/40 bg-teal/[0.08]" : future ? "border-navy/[0.06] bg-transparent" : "border-navy/[0.08] bg-white"
              } ${day === today ? "ring-2 ring-teal-ink/40" : ""}`}
            >
              <span className={`text-right text-xs font-semibold tabular-nums ${future ? "text-navy/40" : "text-navy"}`}>
                {Number(day.slice(8))}
              </span>
              {!future && (
                <span className="flex flex-col gap-0.5">
                  <Mark on={Boolean(p?.morning)} letter="M" label="Départ du matin" />
                  <Mark on={Boolean(p?.evening)} letter="S" label="Retour du soir" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
