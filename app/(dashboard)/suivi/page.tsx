import { garderPage } from "@/lib/acces/garde-page";
import dynamic from "next/dynamic";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TourneesTabs } from "@/components/colis/TourneesTabs";

export const metadata = { title: "Suivi des tournées — GODAC" };

const SuiviTournees = dynamic(() => import("@/components/suivi/SuiviTournees").then((m) => m.SuiviTournees), {
  ssr: false,
  loading: () => <p className="text-sm text-navy/60">Chargement de la carte…</p>,
});

/** Carte de suivi des tournées colis du jour (direction et exploitation). */
export default async function SuiviPage() {
  const g = await garderPage("exploitation.suivi");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const { data: services } = await supabase.from("services").select("id, name").order("name");
  return (
    <div>
      <PageHeader title="Tournées colis" description="Suivi en direct des chauffeurs, des historiques et des tournées villages." />
      <TourneesTabs canTrack />
      <SuiviTournees services={services ?? []} />
    </div>
  );
}
