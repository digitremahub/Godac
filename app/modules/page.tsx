import { LECTURES_PAR_CHAUFFEUR } from "@/lib/usage/quotas";
import { estModuleVendable } from "@/lib/acces/catalogue";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getFullCatalog, priceFor } from "@/lib/organization/catalog";
import { PricingSimulator } from "@/components/modules/PricingSimulator";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { getPaliers } from "@/lib/organization/paliers-serveur";
import { libellePalier } from "@/lib/organization/paliers";

export const metadata = {
  title: "Modules & tarifs — GODAC",
  description:
    "Tarifs GODAC : récupération de la TICPE et contrôle du carburant, puis flotte, planning, paie transport et autres modules à la carte, dont la Tournée colis avec GO Navigation.",
};

/** Nouveautés mises en avant (texte seul : les prix restent ceux du catalogue ci-dessous). */
const NOUVEAUTES = [
  {
    titre: "TICPE sans tableur",
    texte: "Véhicules éligibles repérés depuis la carte grise, montant calculé à chaque plein au barème daté, contrôles avant déclaration, documents prêts pour le comptable et rappels d'échéance.",
  },
  {
    titre: "Planning et arrêts de travail",
    texte: "Glisser-déposer jour, semaine ou mois, recopie de semaine qui ne replace pas les absents, publication aux chauffeurs ; arrêt déclaré en photo, repris dans la paie et les heures.",
  },
  {
    titre: "Paie transport",
    texte: "Modèle IDCC 16 (paniers, primes, heures sup., prélèvement à la source, net social), bulletins PDF, export comptable, validation par la direction, acomptes déduits automatiquement.",
  },
  {
    titre: "Tournée colis + GO Navigation",
    texte: "Scan et lecture d'étiquette, optimisation sur les km routiers avec les horaires des pros, navigation intégrée en vue conduite, ramasses, points relais et preuves de livraison.",
  },
];

/**
 * Public presentation page (no auth required): the public plans and
 * the modules actually shipped today. Numbers here read live from
 * plans/modules/module_plan_prices (see
 * supabase/migrations/20260101000023_align_pricing_with_notion.sql),
 * the same tables onboarding actually charges from — nothing to keep
 * in sync by hand. Unreleased (wave v3) modules are deliberately not
 * shown here — this page only lists what a customer can actually use
 * today. Essentiel is request-only (see the same migration) so it's
 * excluded from every public listing, including the cheapest-tier
 * reference price below.
 */
export default async function ModulesPage() {
  const supabase = await createServerSupabaseClient();
  const [{ plans: allPlans, modules, prices }, paliers, { data: usagePrices }, { data: usageQuotas }] = await Promise.all([
    getFullCatalog(supabase),
    getPaliers(supabase),
    supabase.from("usage_prices").select("feature, label, unit_label, unit_price_eur").order("sort_order"),
    supabase.from("usage_quotas").select("plan_id, feature, included_per_month"),
  ]);
  const inclusPour = (planId: string, feature: string) =>
    (usageQuotas ?? []).find((q) => q.plan_id === planId && q.feature === feature)?.included_per_month;
  const plans = allPlans.filter((p) => p.is_public);
  const cheapestPlanId = plans[0]?.id;

  const v1v2Modules = modules.filter(estModuleVendable);

  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden bg-marine text-[#F0F4FF]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-10 h-96 w-96 rounded-full bg-teal/15 blur-3xl" />
        <SiteHeader />
        <div className="relative mx-auto max-w-3xl px-5 pb-20 pt-10 text-center sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">Une plateforme premium · un seul outil pour piloter votre activité</p>
          <h1 className="mt-4 text-[32px] leading-tight sm:text-5xl">Toute votre exploitation, au même endroit. Sans compromis sur la qualité.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg font-light text-white/75">
            GODAC réunit le carburant, la flotte, les tournées, le planning et les fonctions RH dans un environnement cohérent.
            Moins d&apos;outils à gérer, moins de ressaisies et une vision plus claire pour décider. Choisissez le socle adapté à votre
            flotte, puis ajoutez les modules dont votre entreprise a réellement besoin.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-white/65">
            Une mise en service accompagnée, un abonnement lisible et un interlocuteur pour faire évoluer votre organisation.
          </p>
        </div>
      </div>

    <main className="px-5 py-16 sm:px-6">
      <div className="mx-auto max-w-6xl">

        <section className="mb-16" aria-labelledby="offre-sur-mesure">
          <div className="mb-6 max-w-3xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-teal-ink">Une offre pensée pour durer</p>
            <h2 id="offre-sur-mesure" className="text-2xl sm:text-3xl">Le coût est clair avant de vous engager</h2>
            <p className="mt-3 text-navy/70">
              Comparez le coût complet de votre sélection : abonnement, mise en service et budget récurrent.
              GODAC mise sur la valeur d&apos;une plateforme unifiée, plutôt que sur l&apos;addition de logiciels qui communiquent mal entre eux.
            </p>
          </div>
          <PricingSimulator plans={plans} modules={modules} prices={prices} />
        </section>

        <section className="mb-16" aria-labelledby="nouveautes">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="nouveautes" className="text-2xl sm:text-3xl">Nouveautés</h2>
            <Link href="/contact?essai=go-navigation" className="btn-secondary w-fit">
              Demander un essai GO Navigation
            </Link>
          </div>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {NOUVEAUTES.map((n) => (
              <li key={n.titre} className="card flex flex-col gap-2 border-teal/30">
                <h3 className="text-lg">{n.titre}</h3>
                <p className="text-sm text-navy/70">{n.texte}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-navy/60">
            GO Navigation fait partie du module Tournée colis. L&apos;essai de 30 jours se fait sur invitation, après un premier échange.
          </p>
        </section>

        <h2 className="mb-6 text-2xl sm:text-3xl">Catalogue complet</h2>
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {v1v2Modules.map((m) => {
            const cheapestPrice = cheapestPlanId ? priceFor(prices, m.key, cheapestPlanId) : undefined;
            const alwaysIncluded = cheapestPrice?.included ?? false;
            return (
              <div key={m.key} className="card flex flex-col gap-3">
                <h3 className="text-lg">{m.name}</h3>
                <p className="flex-1 text-sm text-navy/70">{m.description}</p>
                {paliers.some((p) => p.module_key === m.key) && (
                  <div className="rounded-lg bg-navy/[0.04] p-3 text-xs">
                    <p className="mb-1 font-semibold text-navy/80">Par palier d&apos;utilisateurs (chauffeurs actifs)</p>
                    <ul className="flex flex-col gap-0.5 tabular-nums text-navy/70">
                      {paliers
                        .filter((p) => p.module_key === m.key)
                        .sort((a, b) => a.min_users - b.min_users)
                        .map((p) => (
                          <li key={p.min_users} className="flex justify-between gap-2">
                            <span>{libellePalier(p)}</span>
                            <span className="font-semibold text-navy">
                              {Number(p.monthly_price)} €{Number(p.extra_per_user) > 0 && ` + ${Number(p.extra_per_user).toLocaleString("fr-FR")} € par chauffeur au-delà de ${p.min_users}`}
                            </span>
                          </li>
                        ))}
                    </ul>
                    {m.key === "route_optimizer" && (
                      <p className="mt-2 text-navy/65">
                        Lectures par photo (étiquettes, bordereaux, adresses) incluses par chauffeur et par mois : {LECTURES_PAR_CHAUFFEUR.map((l, i, tab) => `${l.parChauffeur}${l.jusqua === null ? ` au-delà de ${tab[i - 1]?.jusqua ?? 0} chauffeurs` : ` jusqu'à ${l.jusqua} chauffeurs`}`).join(", ")}. Une fois le volume atteint, la
                        saisie manuelle reste complète (scan des codes-barres, recherche et saisie des adresses).
                      </p>
                    )}
                  </div>
                )}
                {alwaysIncluded ? (
                  <p className="text-sm text-teal-ink">Inclus dans tous les plans</p>
                ) : (
                  cheapestPrice && (
                    <p className="text-xl font-bold tabular-nums text-gold-ink">
                      à partir de {cheapestPrice.monthly_price} €*
                      <span className="text-sm font-normal text-navy/60">/mois</span>
                    </p>
                  )
                )}
              </div>
            );
          })}
        </div>

        {(usagePrices ?? []).length > 0 && (
          <section className="mb-12">
            <h2 className="mb-2 text-2xl sm:text-3xl">Lectures automatiques et assistant : volumes inclus</h2>
            <p className="mb-6 max-w-3xl text-sm text-navy/70">
              Chaque formule inclut chaque mois un volume de lectures automatiques (tickets, rapports, compteurs…) et de messages à
              l&apos;assistant. Au-delà, vous choisissez : continuer avec une facturation à l&apos;unité sur la facture suivante, ou
              bloquer la fonction jusqu&apos;au mois suivant (la saisie manuelle reste toujours possible).
            </p>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-navy/60">
                  <tr>
                    <th className="pb-2">Fonction</th>
                    {plans.map((p) => (
                      <th key={p.id} className="pb-2 text-right">
                        {p.name}
                      </th>
                    ))}
                    <th className="pb-2 text-right">Au-delà, par unité</th>
                  </tr>
                </thead>
                <tbody>
                  {(usagePrices ?? []).map((u) => (
                    <tr key={u.feature} className="border-t border-navy/5">
                      <td className="py-2">{u.label}</td>
                      {plans.map((p) => (
                        <td key={p.id} className="py-2 text-right tabular-nums">
                          {inclusPour(p.id, u.feature)?.toLocaleString("fr-FR") ?? "—"}
                        </td>
                      ))}
                      <td className="py-2 text-right font-semibold tabular-nums text-gold-ink">
                        {Number(u.unit_price_eur).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} € / {u.unit_label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-navy/60">Volumes par mois et par entreprise (lectures d&apos;étiquettes : le volume par chauffeur de l&apos;application Livreur s&apos;applique s&apos;il est plus favorable) ; prix hors taxes.</p>
          </section>
        )}

        <p className="mb-8 text-center text-xs text-navy/60">
          * Tarifs mensuels, hors frais de mise en service éventuels (facturés une seule fois,
          voir le détail sous chaque plan). Plus de 150 véhicules ?{" "}
          <Link href="mailto:contact@godac.fr" className="underline hover:text-navy">
            Contactez-nous
          </Link>{" "}
          pour une offre Enterprise sur mesure.
        </p>

        <div className="text-center">
          <Link href="/sign-up" className="btn-primary !px-6 !py-3.5 text-base">
            Créer mon organisation
          </Link>
        </div>
      </div>
    </main>
    <SiteFooter />
    </div>
  );
}
