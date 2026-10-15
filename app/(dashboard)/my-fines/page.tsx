import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState, Card } from "@/components/ui";

export default async function MesAmendesPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const enabled = await isModuleEnabled(supabase, appUser.organization_id, "fines");

  if (!enabled) {
    return <EmptyState title="Module Amendes non activé" description="Demandez à la direction d’activer le module Amendes." />;
  }

  const { data } = await supabase
    .from("fines")
    .select("id, infraction_at, amount, reference, status, vehicles(registration)")
    .eq("organization_id", appUser.organization_id)
    .eq("driver_id", appUser.id)
    .order("infraction_at", { ascending: false })
    .limit(200);

  const fines = (data ?? []) as any[];
  const labels: Record<string, string> = {
    pending_identification: "En cours d’identification",
    identified: "À traiter",
    contested: "Contestée",
    paid: "Payée",
  };

  return (
    <div>
      <PageHeader title="Mes amendes" description="Consultez les amendes qui vous ont été attribuées par la direction." />
      {fines.length === 0 ? (
        <EmptyState title="Aucune amende attribuée" description="Les amendes qui vous seront attribuées apparaîtront ici." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Véhicule</th>
                <th className="pb-2">Montant</th>
                <th className="pb-2">Référence</th>
                <th className="pb-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {fines.map((fine) => (
                <tr key={fine.id} className="border-t border-navy/5">
                  <td className="py-3">{new Date(fine.infraction_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="py-3">{fine.vehicles?.registration ?? "—"}</td>
                  <td className="py-3">{Number(fine.amount).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €</td>
                  <td className="py-3">{fine.reference ?? "—"}</td>
                  <td className="py-3">{labels[fine.status] ?? fine.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
