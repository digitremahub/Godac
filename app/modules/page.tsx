import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getFullCatalog, priceFor } from "@/lib/organization/catalog";
import { PricingSimulator } from "@/components/modules/PricingSimulator";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";

export const metadata = {
  title: "Modules & tarifs — GODAC",
};

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
  const { plans: allPlans, modules, prices } = await getFullCatalog(supabase);
  const plans = allPlans.filter((p) => p.is_public);
  const cheapestPlanId = plans[0]?.id;

  const v1v2Modules = modules.filter((m) => m.wave === "v1" || m.wave === "v2");

  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden bg-navy text-[#F0F4FF]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-10 h-96 w-96 rounded-full bg-teal/15 blur-3xl" />
        <SiteHeader />
        <div className="relative mx-auto max-w-3xl px-5 pb-20 pt-10 text-center sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">4 plans selon votre flotte · modules à la carte</p>
          <h1 className="mt-4 text-[32px] leading-tight sm:text-5xl">Choisissez votre plan, ajoutez ce dont vous avez besoin</h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg font-light text-white/75">
            Chaque plan est dimensionné pour votre nombre de véhicules et inclut tout le socle
            opérationnel et RH&nbsp;; les modules avancés restent activables à la carte.
          </p>
        </div>
      </div>

    <main className="px-5 py-16 sm:px-6">
      <div className="mx-auto max-w-6xl">

        <div className="mb-16">
          <PricingSimulator plans={plans} modules={modules} prices={prices} />
        </div>

        <h2 className="mb-6 text-2xl sm:text-3xl">Catalogue complet</h2>
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {v1v2Modules.map((m) => {
            const cheapestPrice = cheapestPlanId ? priceFor(prices, m.key, cheapestPlanId) : undefined;
            const alwaysIncluded = cheapestPrice?.included ?? false;
            return (
              <div key={m.key} className="card flex flex-col gap-3">
                <h3 className="text-lg">{m.name}</h3>
                <p className="flex-1 text-sm text-navy/70">{m.description}</p>
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
