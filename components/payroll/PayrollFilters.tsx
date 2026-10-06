"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

interface DriverOption {
  id: string;
  full_name: string;
}

/** Month + driver filters for /payroll. */
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
    router.push(`/payroll?${qs.toString()}`);
  }

  return (
    <Card className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="label">Mois</label>
        <input className="input !w-auto" type="month" value={month} onChange={(e) => apply({ month: e.target.value })} />
      </div>
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
    </Card>
  );
}
