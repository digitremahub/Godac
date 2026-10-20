import { garderPage } from "@/lib/acces/garde-page";
import { VuePointage } from "@/components/time-clock/VuePointage";

/** Mon espace › Mon pointage : badgeage et historique personnel. */
export default async function MonPointagePage() {
  const g = await garderPage("moi.pointage");
  if (!g.ok) return g.ecran;
  return <VuePointage appUser={g.appUser} supabase={g.supabase} equipe={false} />;
}
