import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState } from "@/components/ui";

export default async function FuelHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string; status?: string }>;
}) {
  const params = await searchParams;
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("fuel_entries")
    .select(
      "id, occurred_at, liters, unit_price, total_amount, status, gap_flagged, station_name, vehicles(registration), users!fuel_entries_driver_id_fkey(full_name), tanks(name)",
    )
    .order("occurred_at", { ascending: false })
    .limit(50);

  if (params.vehicle) query = query.eq("vehicle_id", params.vehicle);
  if (params.status) query = query.eq("status", params.status);

  const { data: entries, error } = await query;

  return (
    <div>
      <PageHeader
        title="Historique carburant"
        description="Tous vos ravitaillements — manuels et OCR validés."
        actions={
          <Link href="/fuel/new" className="btn-primary">
            + Nouveau ravitaillement
          </Link>
        }
      />

      {error && <Card className="mb-4 text-orange">{error.message}</Card>}

      {!entries || entries.length === 0 ? (
        <EmptyState title="Aucun ravitaillement" description="Enregistrez votre premier plein pour le voir apparaître ici." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-white/40">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Véhicule</th>
                <th className="pb-2">Chauffeur</th>
                <th className="pb-2">Cuve</th>
                <th className="pb-2">Litres</th>
                <th className="pb-2">Montant</th>
                <th className="pb-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any) => (
                <tr key={e.id} className="border-t border-white/5">
                  <td className="py-2">{new Date(e.occurred_at).toLocaleString("fr-FR")}</td>
                  <td className="py-2">{e.vehicles?.registration ?? "—"}</td>
                  <td className="py-2">{e.users?.full_name ?? "—"}</td>
                  <td className="py-2">{e.tanks?.name ?? "—"}</td>
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
      )}
    </div>
  );
}

function StatusBadge({ status, gapFlagged }: { status: string; gapFlagged?: boolean }) {
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
