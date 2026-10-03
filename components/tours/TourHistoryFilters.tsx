"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

interface Option {
  id: string;
  name?: string;
  full_name?: string;
}

/** Date range + (direction only) service + driver filters for /tours/history. */
export function TourHistoryFilters({
  from,
  to,
  services,
  drivers,
  selectedService,
  selectedDriver,
}: {
  from: string;
  to: string;
  services: Option[];
  drivers: Option[];
  selectedService: string;
  selectedDriver: string;
}) {
  const router = useRouter();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  function apply(overrides: Record<string, string>) {
    const qs = new URLSearchParams({ from: localFrom, to: localTo, service: selectedService, driver: selectedDriver, ...overrides });
    for (const [key, value] of Array.from(qs.entries())) {
      if (!value) qs.delete(key);
    }
    router.push(`/tours/history?${qs.toString()}`);
  }

  return (
    <Card className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="label">Du</label>
        <input className="input !w-auto" type="date" value={localFrom} onChange={(e) => setLocalFrom(e.target.value)} />
      </div>
      <div>
        <label className="label">Au</label>
        <input className="input !w-auto" type="date" value={localTo} onChange={(e) => setLocalTo(e.target.value)} />
      </div>
      {services.length > 0 && (
        <div>
          <label className="label">Service</label>
          <select className="input !w-auto" value={selectedService} onChange={(e) => apply({ service: e.target.value })}>
            <option value="">Tous les services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {drivers.length > 0 && (
        <div>
          <label className="label">Chauffeur</label>
          <select className="input !w-auto" value={selectedDriver} onChange={(e) => apply({ driver: e.target.value })}>
            <option value="">Tous les chauffeurs</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name}
              </option>
            ))}
          </select>
        </div>
      )}
      <button className="btn-secondary !px-3 !py-1.5 text-sm" onClick={() => apply({})}>
        Appliquer
      </button>
    </Card>
  );
}
