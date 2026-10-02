"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { addDays } from "@/lib/planning/dates";

interface ServiceOption {
  id: string;
  name: string;
}
interface PlanningEntry {
  id: string;
  service_id: string;
  tour_number: string;
  start_at: string;
  status: string;
  vehicles: { registration: string } | null;
  users: { full_name: string } | null;
}

const STATUS_BADGE: Record<string, string> = { planned: "badge-neutral", in_progress: "badge-gold", done: "badge-teal" };
const STATUS_LABEL: Record<string, string> = { planned: "Prévue", in_progress: "En cours", done: "Terminée" };

/** Single-day agenda, grouped by service — the quick "what's happening today" read, editing stays in the week view. */
export function PlanningDayView({
  filteredServices,
  entries,
  day,
  selectedService,
}: {
  services: ServiceOption[];
  filteredServices: ServiceOption[];
  entries: PlanningEntry[];
  day: string;
  selectedService: string;
}) {
  const router = useRouter();

  function navTo(nextDay: string) {
    const qs = new URLSearchParams({ view: "day", day: nextDay });
    if (selectedService) qs.set("service", selectedService);
    router.push(`/planning?${qs.toString()}`);
  }

  const sorted = [...entries].sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(day, -1))}>
          ← Jour préc.
        </button>
        <span className="text-sm text-navy/60">{new Date(`${day}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
        <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => navTo(addDays(day, 1))}>
          Jour suiv. →
        </button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="Aucune tournée ce jour-là" />
      ) : (
        <div className="flex flex-col gap-2">
          {filteredServices.map((service) => {
            const serviceEntries = sorted.filter((e) => e.service_id === service.id);
            if (serviceEntries.length === 0) return null;
            return (
              <Card key={service.id} className="flex flex-col gap-2">
                <p className="text-sm font-medium">{service.name}</p>
                <div className="flex flex-col gap-1.5">
                  {serviceEntries.map((e) => (
                    <div key={e.id} className="flex items-center justify-between rounded-lg bg-navy/5 px-3 py-2 text-sm">
                      <span>
                        {new Date(e.start_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · n°{e.tour_number} ·{" "}
                        {e.users?.full_name ?? "—"} · {e.vehicles?.registration ?? "—"}
                      </span>
                      <span className={STATUS_BADGE[e.status] ?? "badge-neutral"}>{STATUS_LABEL[e.status] ?? e.status}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Link href={`/planning?view=week${selectedService ? `&service=${selectedService}` : ""}`} className="text-sm text-teal-ink hover:underline">
        Passer en vue semaine pour ajouter/déplacer une affectation →
      </Link>
    </div>
  );
}
