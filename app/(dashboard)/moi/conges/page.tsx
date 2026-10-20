import { garderPage } from "@/lib/acces/garde-page";
import { VueConges } from "@/components/leaves/VueConges";

/** Mon espace › Mes congés : demander un congé, suivre ses demandes. */
export default async function MesCongesPage() {
  const g = await garderPage("moi.conges");
  if (!g.ok) return g.ecran;
  return <VueConges appUser={g.appUser} supabase={g.supabase} decision={false} />;
}
