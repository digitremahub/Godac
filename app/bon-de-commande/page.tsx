import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getFullCatalog } from "@/lib/organization/catalog";
import { BonDeCommande } from "@/components/marketing/BonDeCommande";

export const metadata = { title: "Bon de commande — GODAC" };

/**
 * Bon de commande imprimable, prérempli depuis le simulateur de la page
 * Modules & tarifs (?plan=pro&modules=a,b&fondateur=1). Le client le
 * complète, le signe et le renvoie ; les prix viennent du catalogue.
 */
export default async function BonDeCommandePage({ searchParams }: { searchParams: Promise<{ plan?: string; modules?: string; fondateur?: string }> }) {
  const p = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { plans, modules, prices } = await getFullCatalog(supabase);
  return <BonDeCommande plans={plans} modules={modules} prices={prices} planId={p.plan} choisis={(p.modules ?? "").split(",").filter(Boolean)} fondateur={p.fondateur === "1"} />;
}
