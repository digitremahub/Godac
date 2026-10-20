"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

interface DriverOption {
  id: string;
  full_name: string;
}

/** Month + driver filters for /equipe/paie/heures. */
export function PayrollFilters({
  month,
  drivers,
  selectedDriver,
}: {
  month: string;
  drivers: DriverOption[];
  selectedDriver: string;
}) {
  const router = useRouter();

  function apply(overrides: Record<string, string>) {
    const qs = new URLSearchParams({ month, driver: selectedDriver, ...overrides });
    for (const [key, value] of Array.from(qs.entries())) {
      if (!value) qs.delete(key);
    }
    router.push(`/equipe/paie/heures?${qs.toString()}`);
  }

  return (
    <Card className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="block"><span className="label">Mois</span>
        <input className="input !w-auto" type="month" value={month} onChange={(e) => apply({ month: e.target.value })} /></label>
      </div>
      {drivers.length > 0 && (
        <div>
          <label className="block"><span className="label">Chauffeur</span>
          <select className="input !w-auto" value={selectedDriver} onChange={(e) => apply({ driver: e.target.value })}>
            <option value="">Tous les chauffeurs</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name}
              </option>
            ))}
          </select></label>
        </div>
      )}
    </Card>
  );
}
