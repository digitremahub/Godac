import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/clerk/roles";
import { PageHeader, StatTile, Card, EmptyState } from "@/components/ui";
import { QrCodeBadge } from "@/components/qr/QrCodeBadge";
import { RoleGate } from "@/components/layout/RoleGate";
import Link from "next/link";

export default async function DashboardPage() {
  const appUser = await requireAppUser();
  const supabase = createServerSupabaseClient();

  const [vehiclesRes, openAlertsRes, pendingOcrRes, recentEntriesRes] = await Promise.all([
    supabase.from("vehicles").select("id", { count: "exact", head: true }),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("fuel_entries")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending_ocr", "awaiting_validation"]),
    supabase
      .from("fuel_entries")
      .select("id, occurred_at, liters, unit_price, status, vehicles(registration)")
      .order("occurred_at", { ascending: false })
      .limit(6),
  ]);

  return (
    <div>
      <PageHeader
        title={`Bonjour ${appUser.full_name.split(" ")[0] ?? ""}`}
        description="Vue d'ensemble de votre flotte et de votre consommation carburant."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Véhicules" value={String(vehiclesRes.count ?? 0)} />
        <StatTile label="Alertes ouvertes" value={String(openAlertsRes.count ?? 0)} accent="orange" />
        <StatTile label="Tickets OCR en attente" value={String(pendingOcrRes.count ?? 0)} accent="gold" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg">Derniers ravitaillements</h2>
            <Link href="/fuel" className="text-sm text-teal hover:underline">
              Voir tout
            </Link>
          </div>
          {!recentEntriesRes.data || recentEntriesRes.data.length === 0 ? (
            <EmptyState
              title="Aucun ravitaillement enregistré"
              description="Les ravitaillements saisis manuellement ou via OCR apparaîtront ici."
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-white/40">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Véhicule</th>
                  <th className="pb-2">Litres</th>
                  <th className="pb-2">Prix/L</th>
                  <th className="pb-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {recentEntriesRes.data.map((entry: any) => (
                  <tr key={entry.id} className="border-t border-white/5">
                    <td className="py-2">{new Date(entry.occurred_at).toLocaleDateString("fr-FR")}</td>
                    <td className="py-2">{entry.vehicles?.registration ?? "—"}</td>
                    <td className="py-2">{entry.liters} L</td>
                    <td className="py-2">{entry.unit_price} €</td>
                    <td className="py-2">
                      <StatusBadge status={entry.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <RoleGate role={appUser.role} allow={["chauffeur", "manager_chauffeur"]}>
          <div className="flex flex-col items-center justify-center">
            <QrCodeBadge
              type="driver"
              id={appUser.id}
              title={appUser.full_name}
              subtitle="Mon badge chauffeur — à présenter à la pompe"
            />
          </div>
        </RoleGate>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    manual: "badge-neutral",
    validated: "badge-teal",
    pending_ocr: "badge-gold",
    awaiting_validation: "badge-gold",
    ocr_failed: "badge-orange",
  };
  const labels: Record<string, string> = {
    manual: "Manuel",
    validated: "Validé",
    pending_ocr: "OCR en cours",
    awaiting_validation: "À valider",
    ocr_failed: "Échec OCR",
  };
  return <span className={map[status] ?? "badge-neutral"}>{labels[status] ?? status}</span>;
}
