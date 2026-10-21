import { garderPage } from "@/lib/acces/garde-page";
import { hasRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { TanksTab } from "@/components/tanks/VuesCuves";

/** Carburant › Cuves : index totaliseur, stock, photos, ajout de cuve. */
export default async function CuvesPage() {
  const g = await garderPage("carburant.cuves");
  if (!g.ok) return g.ecran;
  const canManage = hasRole(g.appUser.role, ["manager", "exploitation", "direction"]);
  return (
    <div>
      <PageHeader title="Cuves" description="Index totaliseur en temps réel, stock et relevés photo." />
      <TanksTab canManage={canManage} />
    </div>
  );
}
