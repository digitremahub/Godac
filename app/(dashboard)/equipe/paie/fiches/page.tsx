import { garderPage } from "@/lib/acces/garde-page";
import { VueFiches } from "@/components/paie/VueFiches";

/** Équipe › Paie › Fiches de paie : tous les bulletins et leur statut de validation (direction, comptable). */
export default async function FichesPaiePage() {
  const g = await garderPage("equipe.paie_fiches");
  if (!g.ok) return g.ecran;
  return <VueFiches appUser={g.appUser} supabase={g.supabase} toutes />;
}
