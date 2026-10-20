import { garderPage } from "@/lib/acces/garde-page";
import { VueConges } from "@/components/leaves/VueConges";

/** Équipe › Congés : demandes du service, décisions de l'encadrement. */
export default async function CongesEquipePage() {
  const g = await garderPage("equipe.conges");
  if (!g.ok) return g.ecran;
  return <VueConges appUser={g.appUser} supabase={g.supabase} decision />;
}
