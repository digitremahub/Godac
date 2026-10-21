"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import { BandeauRefus } from "@/components/acces/BandeauRefus";

/**
 * Fiche utilisateur (direction, ou exploitation pour un chauffeur ou un
 * manager) : un chauffeur peut être passé manager en
 * gardant la conduite ; un manager peut « conduire aussi » (planning,
 * tournées, pleins, app Livreur, Tournée colis, badge + PIN, palier App
 * Livreur). Remplace l'ancien rôle manager_chauffeur.
 */
export function ConduiteCard({ userId, role, canDrive, nom }: { userId: string; role: string; canDrive: boolean; nom: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);

  async function envoyer(corps: Record<string, unknown>) {
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
    setBusy(false);
    if (!r.ok) setRefus(r.refus);
    else router.refresh();
  }

  if (role === "chauffeur") {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-navy">Passer manager</p>
          <p className="text-navy/65">{nom} devient manager de son service et garde la conduite : planning, tournées, pleins, app Livreur, badge et PIN.</p>
        </div>
        <button
          type="button"
          className="btn-secondary !py-2 text-sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Passer ${nom} manager ? Il gardera ses écrans de conduite.`)) void envoyer({ role: "manager", can_drive: true });
          }}
        >
          {busy ? "Enregistrement…" : "Passer manager"}
        </button>
        <BandeauRefus refus={refus} direction onFermer={() => setRefus(null)} />
      </Card>
    );
  }

  // Manager ou exploitation qui conduit aussi (users.can_drive).
  if (role !== "manager" && role !== "exploitation") return null;
  return (
    <Card className="flex flex-col gap-2">
      <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 accent-teal"
          checked={canDrive}
          disabled={busy}
          onChange={(e) => void envoyer({ can_drive: e.target.checked })}
        />
        <span>
          <span className="font-medium text-navy">Conduit aussi (planning, tournées, app Livreur, badge/PIN)</span>
          <span className="block text-navy/65">Apparaît dans les listes de chauffeurs du planning, démarre et clôture ses tournées, fait ses pleins et compte dans le palier App Livreur.</span>
        </span>
      </label>
      <BandeauRefus refus={refus} direction onFermer={() => setRefus(null)} />
    </Card>
  );
}
