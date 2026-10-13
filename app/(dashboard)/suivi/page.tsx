import dynamic from "next/dynamic";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Suivi des tournées — GODAC" };

const SuiviTournees = dynamic(() => import("@/components/suivi/SuiviTournees").then((m) => m.SuiviTournees), {
  ssr: false,
  loading: () => <p className="text-sm text-navy/60">Chargement de la carte…</p>,
});

/** Carte de suivi des tournées colis du jour (direction et exploitation). */
export default async function SuiviPage() {
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return <EmptyState title="Accès réservé" description="Le suivi des tournées est réservé à la direction et à l'exploitation." />;
  }
  const supabase = await createServerSupabaseClient();
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "route_optimizer"))) {
    return <EmptyState title="Module Tournée colis non activé" description="Le suivi en direct s'appuie sur l'application GODAC Livreur ; la direction peut l'activer depuis Modules & tarifs." />;
  }
  const { data: services } = await supabase.from("services").select("id, name").order("name");
  return (
    <div>
      <PageHeader title="Suivi des tournées" description="Où en sont les chauffeurs : position, adresses et colis restants, heure de fin estimée." />
      <SuiviTournees services={services ?? []} />
    </div>
  );
}
