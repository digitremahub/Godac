import { garderPage } from "@/lib/acces/garde-page";
import { VuePointage } from "@/components/time-clock/VuePointage";

/** Équipe › Pointage : badgeages de l'équipe (direction : tous ; manager : son service). */
export default async function PointageEquipePage() {
  const g = await garderPage("equipe.pointage");
  if (!g.ok) return g.ecran;
  return <VuePointage appUser={g.appUser} supabase={g.supabase} equipe />;
}
