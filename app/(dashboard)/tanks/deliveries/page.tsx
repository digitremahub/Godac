import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TankDeliveriesTable } from "@/components/tanks/TankDeliveriesTable";

export default async function TankDeliveriesPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const { data: deliveries } = await supabase
    .from("tank_deliveries")
    .select("id, liters, unit_price, supplier, delivered_at, invoice_path, tanks(name)")
    .order("delivered_at", { ascending: false });

  const rows = (deliveries ?? []) as any[];
  const withUrls = await Promise.all(
    rows.map(async (d) => {
      const invoiceUrl = d.invoice_path
        ? (await supabase.storage.from("tank-invoices").createSignedUrl(d.invoice_path, 600)).data?.signedUrl ?? null
        : null;
      return {
        id: d.id,
        tankName: d.tanks?.name ?? "—",
        liters: d.liters,
        unitPrice: d.unit_price,
        supplier: d.supplier,
        deliveredAt: d.delivered_at,
        invoiceUrl,
      };
    }),
  );

  return (
    <div>
      <PageHeader
        title="Approvisionnements"
        description="Livraisons de carburant dans les cuves, avec la facture fournisseur quand elle est jointe."
      />
      <TankDeliveriesTable
        deliveries={withUrls}
        canManage={hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])}
      />
    </div>
  );
}
