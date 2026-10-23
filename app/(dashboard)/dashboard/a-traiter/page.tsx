import { garderPage } from "@/lib/acces/garde-page";
import { PageHeader } from "@/components/ui";
import { ATraiter } from "@/components/dashboard/ATraiter";
import { chargerATraiter } from "@/lib/a-traiter/serveur";
import { typesDepuisTexte } from "@/lib/a-traiter/logique";

/**
 * Tableau de bord › À traiter : tout ce qui attend l'exploitation (et la
 * direction) dans une seule liste, triée par urgence puis ancienneté, avec
 * filtres par type et actions groupées. Toute l'entreprise ; jamais ses
 * propres demandes comme « à valider par moi » (lib/hierarchie).
 */
export default async function ATraiterPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const g = await garderPage("dashboard.a_traiter");
  if (!g.ok) return g.ecran;
  const { type } = await searchParams;
  const r = await chargerATraiter(g.supabase, g.appUser, g.modules, { delaiMs: 15000 });
  return (
    <div>
      <PageHeader title="À traiter aujourd'hui" description="Tout ce qui attend l'exploitation, du plus urgent au plus ancien. Cochez plusieurs éléments pour les valider ou les refuser en une fois." />
      <ATraiter
        presentation="page"
        elements={r.elements}
        verrouilles={r.verrouilles}
        erreurs={r.erreurs}
        plafonnes={r.plafonnes}
        maintenantIso={new Date().toISOString()}
        typesInitiaux={typesDepuisTexte(type)}
      />
    </div>
  );
}
