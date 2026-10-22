"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { grouperParPole } from "@/lib/organization/poles";

interface ServiceOption {
  id: string;
  name: string;
  pole?: string | null;
}

const VIEWS: { key: string; label: string }[] = [
  { key: "day", label: "Jour" },
  { key: "week", label: "Semaine" },
  { key: "month", label: "Mois" },
];

/**
 * Choix de la vue (Jour, Semaine, Mois) et filtre par service, une seule
 * fois au-dessus de la vue active. Le retour à aujourd'hui se fait en
 * cliquant la date, entre les flèches de chaque vue.
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

  // Changer de vue garde la date regardée (jour → sa semaine, son mois) et le service.
  function goTo(nextView: string) {
    const qs = new URLSearchParams(searchParams.toString());
    const jour = qs.get("day");
    if (jour && nextView === "week") qs.set("week", jour);
    if (nextView === "month" && !qs.get("month")) {
      const ref = jour ?? qs.get("week");
      if (ref) qs.set("month", ref.slice(0, 7));
    }
    if (nextView === "day" && !jour && qs.get("week")) qs.set("day", qs.get("week")!);
    qs.set("view", nextView);
    if (selectedService) qs.set("service", selectedService);
    router.push(`/exploitation/planning?${qs.toString()}`);
  }

  // Changer de service garde aussi la date regardée.
  function setService(serviceId: string) {
    const qs = new URLSearchParams(searchParams.toString());
    if (serviceId) qs.set("service", serviceId);
    else qs.delete("service");
    router.push(`/exploitation/planning?${qs.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-navy/[0.04] p-1" role="tablist" aria-label="Vue du planning">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`min-h-[44px] rounded-md px-4 text-sm transition-colors ${
              view === v.key ? "bg-surface font-semibold shadow-sm" : "text-navy/65 hover:text-navy"
            }`}
            onClick={() => goTo(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      {services.length > 0 && (
        <select aria-label="Filtrer par service" className="input min-h-[44px] !w-auto" value={selectedService} onChange={(e) => setService(e.target.value)}>
          <option value="">Tous les services</option>
          {grouperParPole(services).map(({ pole, services: groupe }) => (
            <optgroup key={pole.key} label={pole.operationnel ? pole.label : `${pole.label} — présence`}>
              {groupe.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  );
}
