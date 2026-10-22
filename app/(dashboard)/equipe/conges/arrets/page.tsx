import { garderPage } from "@/lib/acces/garde-page";
import { VueArretsEquipe } from "@/components/arrets/VueArretsEquipe";

/** Équipe › Congés & absences › Arrêts de travail : vérifier, valider, remplacer au planning. */
export default async function ArretsEquipePage({ searchParams }: { searchParams: Promise<{ arret?: string }> }) {
  const g = await garderPage("equipe.arrets");
  if (!g.ok) return g.ecran;
  const sp = await searchParams;
  return <VueArretsEquipe appUser={g.appUser} supabase={g.supabase} modules={g.modules} arretId={sp.arret} />;
}
