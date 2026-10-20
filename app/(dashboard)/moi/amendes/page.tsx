import { garderPage } from "@/lib/acces/garde-page";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, Card } from "@/components/ui";
import { DriverFineActions } from "@/components/fines/DriverFineActions";

export default async function MesAmendesPage() {
  const g = await garderPage("moi.amendes");
  if (!g.ok) return g.ecran;
  const user = g.appUser;
  const supabase = await createServerSupabaseClient();
  // Use service-role only after authenticating; scope strictly to this user and organization.
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from("fines")
    .select("id, infraction_at, amount, reference, status, notified_at, vehicles(registration)")
    .eq("organization_id", user.organization_id).eq("driver_id", user.id)
    .order("infraction_at", { ascending: false }).limit(200);
  const fines = (data ?? []) as any[];
  const label: Record<string, string> = {
    pending_identification: "En cours d’identification",
    identified: "À traiter",
    contested: "Contestation signalée",
    paid: "Payée",
  };
  return <div>
    <PageHeader title="Mes amendes" description="Consultez les amendes qui vous sont attribuées. Vous pouvez signaler votre désaccord à la direction." />
    {fines.length === 0 ? <EmptyState title="Aucune amende attribuée" description="Les amendes qui vous seront attribuées par la direction apparaîtront ici." /> :
      <div className="flex flex-col gap-3">{fines.map((f) => <Card key={f.id} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-display text-lg font-bold">{f.vehicles?.registration ?? "Véhicule non renseigné"}</p>
          <p className="text-sm text-navy/65">{new Date(f.infraction_at).toLocaleString("fr-FR", {timeZone:"Europe/Paris", dateStyle:"medium", timeStyle:"short"})}</p></div>
          <span className="badge-neutral">{label[f.status] ?? f.status}</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm"><span><strong>Montant :</strong> {Number(f.amount).toLocaleString("fr-FR",{minimumFractionDigits:2})} €</span><span><strong>Référence :</strong> {f.reference ?? "—"}</span></div>
        {f.notified_at && <p className="text-xs text-navy/55">Notification reçue le {new Date(f.notified_at).toLocaleDateString("fr-FR")}</p>}
        {f.status === "identified" && <DriverFineActions id={f.id} />}
      </Card>)}</div>}
  </div>;
}
