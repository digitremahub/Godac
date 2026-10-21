import { garderPage } from "@/lib/acces/garde-page";
import { hasRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { DeliveriesTab } from "@/components/tanks/VuesCuves";

/** Carburant › Approvisionnements : livraisons de carburant dans les cuves. */
export default async function ApprovisionnementsPage() {
  const g = await garderPage("carburant.approvisionnements");
  if (!g.ok) return g.ecran;
  const canManage = hasRole(g.appUser.role, ["manager", "exploitation", "direction"]);
  return (
    <div>
      <PageHeader title="Approvisionnements" description="Livraisons de carburant dans les cuves." />
      <DeliveriesTab supabase={g.supabase} canManage={canManage} />
    </div>
  );
}
