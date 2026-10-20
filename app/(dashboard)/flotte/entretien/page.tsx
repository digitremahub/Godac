import { garderPage } from "@/lib/acces/garde-page";
import { VueEntretien } from "@/components/maintenance/VueEntretien";

/** Flotte › Entretien : demandes des chauffeurs, traitement par l'encadrement. */
export default async function EntretienPage({ searchParams }: { searchParams: Promise<{ vehicle?: string }> }) {
  const g = await garderPage("flotte.entretien");
  if (!g.ok) return g.ecran;
  const { vehicle } = await searchParams;
  return <VueEntretien appUser={g.appUser} supabase={g.supabase} vehicle={vehicle} />;
}
