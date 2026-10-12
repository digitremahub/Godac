"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { todayISO, currentMonth } from "@/lib/planning/dates";

interface ServiceOption {
  id: string;
  name: string;
}

const VIEWS: { key: string; label: string }[] = [
  { key: "week", label: "Semaine" },
  { key: "day", label: "Jour" },
  { key: "month", label: "Mois" },
  { key: "kanban", label: "Kanban" },
  { key: "list", label: "Liste" },
];

/**
 * Shared view switcher + "Aujourd'hui" reset + service filter, rendered
 * once above whichever view component is active — the single place the
 * service filter lives, so all five views get it instead of each
 * reimplementing their own <select> (only the week grid used to have one).
 */
export function PlanningViewTabs({
  view,
  selectedService,
  services = [],
}: {
  view: string;
  selectedService: string;
  services?: ServiceOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // Changing the service filter keeps whatever date the user is
  // currently looking at (week/day/month) instead of resetting it —
  // unlike goTo/goToday, which intentionally jump to a fresh default.
  function setService(serviceId: string) {
    const qs = new URLSearchParams(searchParams.toString());
    if (serviceId) qs.set("service", serviceId);
    else qs.delete("service");
    router.push(`/planning?${qs.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-navy/[0.04] p-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === v.key ? "bg-white shadow-sm" : "text-navy/65 hover:text-navy"
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
      {services.length > 0 && (
        <select aria-label="Filtrer par service" className="input !w-auto" value={selectedService} onChange={(e) => setService(e.target.value)}>
          <option value="">Tous les services</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
