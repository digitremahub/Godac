import { garderPage } from "@/lib/acces/garde-page";
import { EmptyState, PageHeader } from "@/components/ui";
import { MesAcomptes } from "@/components/paie/Acomptes";
import { moisCourantParis } from "@/lib/paie/acomptes";
import { CHAMPS_DEMANDE, MESSAGE_TABLE_ABSENTE, plafondDuSalarie, tableAcomptesAbsente, versDemande } from "@/lib/paie/acomptes-serveur";

/** Mon espace › Demander un acompte : demande du mois, plafond indicatif et historique. */
export default async function MesAcomptesPage() {
  const g = await garderPage("moi.acomptes");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;

  const [{ data, error }, { plafond }] = await Promise.all([
    supabase.from("salary_advance_requests").select(CHAMPS_DEMANDE).eq("user_id", appUser.id).order("created_at", { ascending: false }).limit(50),
    plafondDuSalarie(supabase, appUser.organization_id, appUser.id),
  ]);

  return (
    <div>
      <PageHeader title="Demander un acompte" description="Une avance sur le salaire du mois, déduite ensuite de votre bulletin de paie." />
      {error ? (
        <EmptyState title="Bientôt disponible" description={tableAcomptesAbsente(error) ? MESSAGE_TABLE_ABSENTE : `Lecture impossible : ${error.message}`} />
      ) : (
        <MesAcomptes demandes={((data ?? []) as Record<string, unknown>[]).map(versDemande)} plafond={plafond} mois={moisCourantParis()} />
      )}
    </div>
  );
}
