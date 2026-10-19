import Link from "next/link";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { paysOrganisation } from "@/lib/pays/serveur";
import { TourneeColis } from "@/components/colis/TourneeColis";
import { TourneesTabs } from "@/components/colis/TourneesTabs";
import { HistoriqueTournees } from "@/components/colis/HistoriqueTournees";
import { AffecterTourneeColis } from "@/components/colis/AffecterTourneeColis";
import { detailTournee, historiqueTournees, lireFiltres, lireRecherche, rechercherColis } from "@/lib/colis/historique";
import { parisDay } from "@/lib/utils/paris-time";

/**
 * Tournée colis : préparation/affectation pour l'encadrement, fiche quotidienne
 * et scan pour le chauffeur, plus historique des tournées.
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
    const recherche = lireRecherche(params);
    const [historique, detail, resultats] = await Promise.all([
      historiqueTournees(supabase, appUser.id, encadrement, filtres),
      tournee ? detailTournee(supabase, appUser.id, encadrement, tournee) : Promise.resolve(null),
      rechercherColis(supabase, appUser.id, encadrement, filtres, recherche),
    ]);
    return (
      <div>
        <PageHeader
          title="Tournée colis"
          description={encadrement ? "Historique des tournées colis de l'entreprise : filtrez par date, service, chauffeur ou camion." : "Historique de vos tournées colis."}
        />
        <TourneesTabs canTrack={encadrement} />
        {onglets}
        <HistoriqueTournees
          historique={historique}
          detail={detail}
          aujourdhui={aujourdhui}
          encadrement={encadrement}
          direction={appUser.role === "direction"}
          recherche={recherche}
          resultats={resultats}
        />
      </div>
    );
  }

  let affectation: { services: { id: string; name: string }[]; drivers: { id: string; full_name: string }[]; vehicles: { id: string; registration: string; service_id: string | null }[]; tours: { id: string; tour_number: string; service_id: string }[] } | null = null;
  if (encadrement) {
    const [{ data: services }, { data: drivers }, { data: vehicles }, { data: tours }] = await Promise.all([
      supabase.from("services").select("id,name").eq("organization_id", appUser.organization_id).order("name"),
      supabase.from("users").select("id,full_name").eq("organization_id", appUser.organization_id).eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
      supabase.from("vehicles").select("id,registration,service_id").eq("organization_id", appUser.organization_id).order("registration"),
      supabase.from("tour_routes").select("id,tour_number,service_id").eq("organization_id", appUser.organization_id).order("tour_number"),
    ]);
    affectation = { services: services ?? [], drivers: drivers ?? [], vehicles: vehicles ?? [], tours: tours ?? [] };
  }

  return (
    <div>
      <PageHeader title="Tournée colis" description={encadrement ? "Préparez les tournées, affectez-les aux chauffeurs et suivez les colis." : "Retrouvez votre tournée quotidienne, scannez les colis et suivez votre parcours."} />
      <TourneesTabs canTrack={encadrement} />
      {onglets}
      {encadrement && affectation && (
        <section className="mb-5 rounded-2xl border border-navy/10 bg-surface p-4">
          <h2 className="text-base font-semibold text-navy">Préparer et affecter une tournée</h2>
          <p className="mt-1 text-sm text-navy/65">Créez d'abord le modèle avec son numéro, ses villages, ramasses et points relais, puis affectez-le ci-dessous.</p>
          <Link href="/tours/routes" className="btn-secondary mt-3 inline-flex">Créer / modifier les tournées et villages</Link>
          <div className="mt-4">
            <AffecterTourneeColis services={affectation.services} drivers={affectation.drivers} vehicles={affectation.vehicles} tours={affectation.tours} />
          </div>
        </section>
      )}
      <TourneeColis lectureEtiquette pays={pays.code} encadrement={encadrement} />
    </div>
  );
}
