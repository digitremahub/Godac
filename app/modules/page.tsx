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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">Carburant inclus dans tous les plans · modules à la carte</p>
          <h1 className="mt-4 text-[32px] leading-tight sm:text-5xl">Contrôlez le carburant, ajoutez le reste quand vous voulez</h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg font-light text-white/75">
            Chaque plan est dimensionné pour votre nombre de véhicules et inclut le contrôle du carburant (pleins, tickets lus
            automatiquement, cuves, anomalies). Flotte, planning, tournées, paie&nbsp;: les autres modules s&apos;activent à la carte,
            dans le même outil.
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
            <p className="mt-2 text-xs text-navy/60">Volumes par mois et par entreprise ; prix hors taxes.</p>
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
