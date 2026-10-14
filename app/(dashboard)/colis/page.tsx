import Link from "next/link";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { paysOrganisation } from "@/lib/pays/serveur";
import { TourneeColis } from "@/components/colis/TourneeColis";
import { TourneesTabs } from "@/components/colis/TourneesTabs";
import { HistoriqueTournees } from "@/components/colis/HistoriqueTournees";
import { detailTournee, historiqueTournees, lireFiltres } from "@/lib/colis/historique";
import { parisDay } from "@/lib/utils/paris-time";

/**
 * Tournée colis : onglet « Tournée du jour » (scan des colis, ordre
 * optimisé, livraison arrêt par arrêt) et onglet « Historique » (tournées
 * passées filtrées par date, service, chauffeur, camion — filtres dans
 * l'URL). Historique : l'encadrement voit toutes les tournées de
 * l'entreprise, un chauffeur les siennes.
 */
export default async function ColisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const [actif, pays] = await Promise.all([
    isModuleEnabled(supabase, appUser.organization_id, "route_optimizer"),
    paysOrganisation(supabase, appUser.organization_id),
  ]);
  if (!actif) return <EmptyState title="Module Tournée colis non activé" description="La direction peut l'activer depuis Modules & tarifs." />;

  const encadrement = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);
  const historiqueVisible = encadrement || appUser.role === "chauffeur";
  const onglet = historiqueVisible && params.onglet === "historique" ? "historique" : "jour";

  const onglets = historiqueVisible && (
    <div className="mb-5 flex gap-1 border-b border-navy/10" role="tablist" aria-label="Tournée colis">
      {(
        [
          ["jour", "Tournée du jour", "/colis"],
          ["historique", "Historique", "/colis?onglet=historique"],
        ] as const
      ).map(([cle, libelle, href]) => (
        <Link
          key={cle}
          href={href}
          role="tab"
          aria-selected={onglet === cle}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${onglet === cle ? "border-teal text-navy" : "border-transparent text-navy/55 hover:text-navy"}`}
        >
          {libelle}
        </Link>
      ))}
    </div>
  );

  if (onglet === "historique") {
    const aujourdhui = parisDay();
    const filtres = lireFiltres(params, aujourdhui);
    const tournee = typeof params.tournee === "string" ? params.tournee : null;
    const [historique, detail] = await Promise.all([
      historiqueTournees(supabase, appUser.id, encadrement, filtres),
      tournee ? detailTournee(supabase, appUser.id, encadrement, tournee) : Promise.resolve(null),
    ]);
    return (
      <div>
        <PageHeader
          title="Tournée colis"
          description={encadrement ? "Historique des tournées colis de l'entreprise : filtrez par date, service, chauffeur ou camion." : "Historique de vos tournées colis."}
        />
        <TourneesTabs canTrack={encadrement} />
        {onglets}
        <HistoriqueTournees historique={historique} detail={detail} aujourdhui={aujourdhui} encadrement={encadrement} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Tournée colis" description="Scannez vos colis, GODAC place les adresses dans le meilleur ordre de passage." />
      <TourneesTabs canTrack={encadrement} />
      {onglets}
      <TourneeColis lectureEtiquette pays={pays.code} />
    </div>
  );
}
