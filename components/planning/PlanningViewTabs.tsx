"use client";

import { useRouter } from "next/navigation";
import { todayISO, currentMonth } from "@/lib/planning/dates";

const VIEWS: { key: string; label: string }[] = [
  { key: "week", label: "Semaine" },
  { key: "day", label: "Jour" },
  { key: "month", label: "Mois" },
  { key: "kanban", label: "Kanban" },
  { key: "list", label: "Liste" },
];

/** Shared view switcher + "Aujourd'hui" reset, rendered once above whichever view component is active. */
export function PlanningViewTabs({ view, selectedService }: { view: string; selectedService: string }) {
  const router = useRouter();

  function goTo(nextView: string) {
    const qs = new URLSearchParams();
    qs.set("view", nextView);
    if (selectedService) qs.set("service", selectedService);
    router.push(`/planning?${qs.toString()}`);
  }

  function goToday() {
    const qs = new URLSearchParams();
    qs.set("view", view);
    qs.set("week", todayISO());
    qs.set("day", todayISO());
    qs.set("month", currentMonth());
    if (selectedService) qs.set("service", selectedService);
    router.push(`/planning?${qs.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-navy/5 p-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === v.key ? "bg-white shadow-sm" : "text-navy/50 hover:text-navy"
            }`}
            onClick={() => goTo(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={goToday}>
        Aujourd&apos;hui
      </button>
    </div>
  );
}
