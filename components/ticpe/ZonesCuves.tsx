"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";

/** Zone TICPE de chaque cuve (les pleins faits à la cuve prennent sa zone). */
export function ZonesCuves({ cuves, modifiable }: { cuves: { id: string; name: string; ticpe_zone: "metropole" | "corse" | null }[]; modifiable: boolean }) {
  const router = useRouter();
  const [refus, setRefus] = useState<Refus | null>(null);
  async function changer(id: string, zone: string) {
    setRefus(null);
    const r = await fetchGodac(`/api/ticpe/cuves/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticpe_zone: zone }) });
    if (!r.ok) return setRefus(r.refus);
    router.refresh();
  }
  if (cuves.length === 0) return <p className="text-sm text-navy/60">Aucune cuve.</p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
      {cuves.map((c) => (
        <label key={c.id} className="flex items-center justify-between gap-3">
          <span>{c.name}</span>
          <select className="input !w-auto" disabled={!modifiable} value={c.ticpe_zone ?? "metropole"} onChange={(e) => void changer(c.id, e.target.value)}>
            <option value="metropole">Métropole hors Corse</option>
            <option value="corse">Corse</option>
          </select>
        </label>
      ))}
    </div>
  );
}
