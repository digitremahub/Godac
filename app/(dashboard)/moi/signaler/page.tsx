import { garderPage } from "@/lib/acces/garde-page";
import { VueEntretien } from "@/components/maintenance/VueEntretien";

/** Mon espace › Signaler un problème : demande d'entretien du chauffeur et suivi de ses demandes. */
export default async function SignalerPage({ searchParams }: { searchParams: Promise<{ vehicle?: string }> }) {
  const g = await garderPage("moi.signaler");
  if (!g.ok) return g.ecran;
  const { vehicle } = await searchParams;
  return <VueEntretien appUser={g.appUser} supabase={g.supabase} vehicle={vehicle} titre="Signaler un problème" />;
}
