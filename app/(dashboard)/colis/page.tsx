import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { TourneeColis } from "@/components/colis/TourneeColis";

/** Tournée colis du jour : scan des colis, ordre optimisé, livraison arrêt par arrêt. */
export default async function ColisPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const [actif, ocr] = await Promise.all([
    isModuleEnabled(supabase, appUser.organization_id, "route_optimizer"),
    isModuleEnabled(supabase, appUser.organization_id, "ocr"),
  ]);
  if (!actif) return <EmptyState title="Module Tournée colis non activé" description="La direction peut l'activer depuis Modules & tarifs." />;
  return (
    <div>
      <PageHeader title="Tournée colis" description="Scannez vos colis, GODAC place les adresses dans le meilleur ordre de passage." />
      <TourneeColis lectureEtiquette={ocr} />
    </div>
  );
}
