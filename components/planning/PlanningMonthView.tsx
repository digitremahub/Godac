"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { monthCalendarDays, addMonths } from "@/lib/planning/dates";

interface PlanningEntry {
  id: string;
  start_at: string;
  tour_number: string;
  users: { full_name: string } | null;
}

const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MAX_VISIBLE_PER_DAY = 3;

/** Calendar-grid month overview — read-only (click a day to drill into the day view), good for spotting gaps/overload at a glance. */
export function PlanningMonthView({
  entries,
  month,
  selectedService,
}: {
  entries: PlanningEntry[];
  month: string;
  selectedService: string;
}) {
  const router = useRouter();
  const days = monthCalendarDays(month);
  const monthParts = month.split("-");
  const currentYear = Number(monthParts[0] ?? 0);
  const currentMonthNum = Number(monthParts[1] ?? 1);

  function navTo(nextMonth: string) {
    const qs = new URLSearchParams({ view: "month", month: nextMonth });
    if (selectedService) qs.set("service", selectedService);
    router.push(`/exploitation/planning?${qs.toString()}`);
  }

  const entriesByDay = new Map<string, PlanningEntry[]>();
  for (const e of entries) {
    const day = e.start_at.slice(0, 10);
    entriesByDay.set(day, [...(entriesByDay.get(day) ?? []), e]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addMonths(month, -1))}>
          ← Mois préc.
        </button>
        <span className="text-sm text-navy/70">
          {new Date(currentYear, currentMonthNum - 1, 1).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", month: "long", year: "numeric" })}
        </span>
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addMonths(month, 1))}>
          Mois suiv. →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-xs">
        {DAY_LABELS.map((l) => (
          <div key={l} className="px-1 text-navy/60">
            {l}
          </div>
        ))}
        {days.map((day) => {
          const dayEntries = entriesByDay.get(day) ?? [];
          const inMonth = day.slice(0, 7) === month;
          return (
            <Link
              key={day}
              href={`/exploitation/planning?view=day&day=${day}${selectedService ? `&service=${selectedService}` : ""}`}
              className={`flex min-h-[72px] flex-col gap-0.5 rounded-lg border border-navy/10 p-1.5 ${
                inMonth ? "bg-surface" : "bg-navy/[0.04] text-navy/60"
              }`}
            >
              <span className="font-medium">{Number(day.slice(8, 10))}</span>
              {dayEntries.slice(0, MAX_VISIBLE_PER_DAY).map((e) => (
                <span key={e.id} className="truncate rounded bg-teal/15 px-1 text-[11px] text-navy/70">
                  n°{e.tour_number}
                </span>
              ))}
              {dayEntries.length > MAX_VISIBLE_PER_DAY && (
                <span className="text-[11px] text-navy/60">+{dayEntries.length - MAX_VISIBLE_PER_DAY}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
