import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getFullCatalog, priceFor } from "@/lib/organization/catalog";
import { PricingSimulator } from "@/components/modules/PricingSimulator";

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
    <main className="min-h-screen px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <span className="badge-teal mb-4 inline-block">4 plans selon votre flotte + modules à la carte</span>
          <h1 className="text-4xl md:text-5xl">Choisissez votre plan, ajoutez ce dont vous avez besoin</h1>
          <p className="mx-auto mt-4 max-w-2xl text-navy/60">
            Chaque plan est dimensionné pour votre nombre de véhicules et inclut tout le socle
            opérationnel et RH ; les modules avancés restent activables à la carte.
          </p>
        </div>

        <div className="mb-16">
          <PricingSimulator plans={plans} modules={modules} prices={prices} />
        </div>

        <h2 className="mb-4 text-xl text-navy/80">Catalogue complet</h2>
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {v1v2Modules.map((m) => {
            const cheapestPrice = cheapestPlanId ? priceFor(prices, m.key, cheapestPlanId) : undefined;
            const alwaysIncluded = cheapestPrice?.included ?? false;
            return (
              <div key={m.key} className="card flex flex-col gap-3">
                <h3 className="text-lg">{m.name}</h3>
                <p className="flex-1 text-sm text-navy/60">{m.description}</p>
                {alwaysIncluded ? (
                  <p className="text-sm text-teal-ink">Inclus dans tous les plans</p>
                ) : (
                  cheapestPrice && (
                    <p className="font-display text-xl font-extrabold text-gold-ink">
                      à partir de {cheapestPrice.monthly_price} €*
                      <span className="text-sm font-normal text-navy/40">/mois</span>
                    </p>
                  )
                )}
              </div>
            );
          })}
        </div>

        <p className="mb-8 text-center text-xs text-navy/40">
          * Tarifs mensuels, hors frais de mise en service éventuels (facturés une seule fois,
          voir le détail sous chaque plan). Plus de 150 véhicules ?{" "}
          <Link href="mailto:contact@godac.fr" className="underline hover:text-navy/60">
            Contactez-nous
          </Link>{" "}
          pour une offre Enterprise sur mesure.
        </p>

        <div className="text-center">
          <Link href="/sign-up" className="btn-primary">
            Créer mon organisation
          </Link>
        </div>
      </div>
    </main>
  );
}
