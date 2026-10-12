import { Card, EmptyState } from "@/components/ui";

export interface FuelHistoryRow {
  id: string;
  occurred_at: string;
  liters: number | null;
  total_amount: number | null;
  status: string;
  gap_flagged?: boolean | null;
  vehicles?: { registration: string } | null;
  users?: { full_name: string } | null;
}

function StatusBadge({ status, gapFlagged }: { status: string; gapFlagged?: boolean | null }) {
  if (gapFlagged) return <span className="badge-orange">Écart détecté</span>;
  const map: Record<string, { cls: string; label: string }> = {
    manual: { cls: "badge-neutral", label: "Manuel" },
    validated: { cls: "badge-teal", label: "Validé" },
    pending_ocr: { cls: "badge-gold", label: "OCR en cours" },
    awaiting_validation: { cls: "badge-gold", label: "À valider" },
    ocr_failed: { cls: "badge-orange", label: "Échec OCR" },
  };
  const s = map[status] ?? { cls: "badge-neutral", label: status };
  return <span className={s.cls}>{s.label}</span>;
}

/**
 * Shared "who had which vehicle when" table, driven by fuel_entries
 * (the only table with real per-day driver+vehicle data today — see
 * app/(dashboard)/fuel/page.tsx, the vehicle detail page's
 * "Historique des chauffeurs", and the driver detail page's
 * "Historique des véhicules"). Hide whichever of the vehicle/driver
 * columns is redundant given the page's own context.
 */
export function FuelHistoryTable({
  entries,
  showVehicle = true,
  showDriver = true,
  emptyDescription = "Aucun ravitaillement enregistré pour l'instant.",
}: {
  entries: FuelHistoryRow[];
  showVehicle?: boolean;
  showDriver?: boolean;
  emptyDescription?: string;
}) {
  if (entries.length === 0) {
    return <EmptyState title="Aucun historique" description={emptyDescription} />;
  }

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Date</th>
            {showVehicle && <th className="pb-2">Véhicule</th>}
            {showDriver && <th className="pb-2">Chauffeur</th>}
            <th className="pb-2">Litres</th>
            <th className="pb-2">Montant</th>
            <th className="pb-2">Statut</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t border-navy/5">
              <td className="py-2">{new Date(e.occurred_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
              {showVehicle && <td className="py-2">{e.vehicles?.registration ?? "—"}</td>}
              {showDriver && <td className="py-2">{e.users?.full_name ?? "—"}</td>}
              <td className="py-2">{e.liters ?? "—"} L</td>
              <td className="py-2">{e.total_amount ?? "—"} €</td>
              <td className="py-2">
                <StatusBadge status={e.status} gapFlagged={e.gap_flagged} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
