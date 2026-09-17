import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { TicpeExportForm } from "@/components/ticpe/TicpeExportForm";

export default async function TicpePage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const ticpeEnabled = await isModuleEnabled(supabase, appUser.organization_id, "ticpe_export");
  if (!ticpeEnabled) {
    return <EmptyState title="Module Export TICPE non activé" description="Activez-le depuis les paramètres de votre organisation." />;
  }

  const { data: exports } = await supabase
    .from("ticpe_exports")
    .select("id, period_start, period_end, vehicle_count, total_liters, created_at")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="Export TICPE"
        description="Périmètre PL/SPL uniquement — les VL sont exclus par règle métier, jamais par oubli de filtre."
      />

      <TicpeExportForm />

      {!exports || exports.length === 0 ? (
        <EmptyState title="Aucun export généré" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="text-left text-navy/40">
              <tr>
                <th className="pb-2">Généré le</th>
                <th className="pb-2">Période</th>
                <th className="pb-2">Véhicules</th>
                <th className="pb-2">Litres totaux</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {exports.map((exp: any) => (
                <tr key={exp.id} className="border-t border-navy/5">
                  <td className="py-2">{new Date(exp.created_at).toLocaleString("fr-FR")}</td>
                  <td className="py-2">
                    {exp.period_start} → {exp.period_end}
                  </td>
                  <td className="py-2">{exp.vehicle_count}</td>
                  <td className="py-2">{Number(exp.total_liters).toLocaleString("fr-FR")} L</td>
                  <td className="py-2">
                    <a href={`/api/ticpe/exports/${exp.id}/download`} className="text-teal-ink hover:underline">
                      Télécharger
                    </a>
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
