import { garderPage } from "@/lib/acces/garde-page";
import { VueFiches } from "@/components/paie/VueFiches";

/** Mon espace › Mes fiches de paie : ses bulletins validés par la direction. */
export default async function MesFichesPage() {
  const g = await garderPage("moi.fiches_paie");
  if (!g.ok) return g.ecran;
  return <VueFiches appUser={g.appUser} supabase={g.supabase} toutes={false} />;
}
