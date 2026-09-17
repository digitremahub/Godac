import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getFullCatalog, type PlanId } from "@/lib/organization/catalog";
import { PricingSimulator } from "@/components/modules/PricingSimulator";

export const metadata = {
  title: "Modules & tarifs — GODAC",
};

const WAVE_LABELS: Record<string, string> = {
  v1: "Disponible aujourd'hui",
  v2: "Disponible aujourd'hui (upsell)",
};

/**
 * Public presentation page (no auth required): the 4 plans and the
 * modules actually shipped today, both à la carte and per-plan.
 * Numbers here read live from plans/modules/module_plan_prices (see
 * supabase/migrations/20260101000015_module_catalog.sql), the same
 * tables onboarding actually charges from — nothing to keep in sync
 * by hand. Unreleased (wave v3) modules are deliberately not shown
 * here — this page only lists what a customer can actually use today.
 */
export default async function ModulesPage() {
  const supabase = await createServerSupabaseClient();
  const { plans, modules, prices } = await getFullCatalog(supabase);

  const v1v2Modules = modules.filter((m) => m.wave === "v1" || m.wave === "v2");
  const planName = (id: PlanId | null) => (id ? plans.find((p) => p.id === id)?.name ?? id : null);

  return (
    <main className="min-h-screen px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <span className="badge-teal mb-4 inline-block">4 plans + modules à la carte</span>
          <h1 className="text-4xl md:text-5xl">Choisissez votre plan, ajoutez ce dont vous avez besoin</h1>
          <p className="mx-auto mt-4 max-w-2xl text-navy/60">
            Chaque plan inclut un socle de modules ; tout module non inclus reste activable à la
            carte, au prix indiqué ci-dessous.
          </p>
        </div>

        <div className="mb-16">
          <PricingSimulator plans={plans} modules={modules} prices={prices} />
        </div>

        <h2 className="mb-4 text-xl text-navy/80">Catalogue complet — {WAVE_LABELS.v1}</h2>
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {v1v2Modules.map((m) => {
            const includedPlan = planName(m.included_from_plan);
            return (
              <div key={m.key} className="card flex flex-col gap-3">
                <h3 className="text-lg">{m.name}</h3>
                <p className="flex-1 text-sm text-navy/60">{m.description}</p>
                {includedPlan ? (
                  <p className="text-sm text-teal-ink">Inclus dès le plan {includedPlan}</p>
                ) : (
                  <p className="text-sm text-navy/40">Jamais inclus dans un plan — à la carte uniquement</p>
                )}
                {m.base_price > 0 && (
                  <p className="font-display text-xl font-extrabold text-gold-ink">
                    +{m.base_price} €*<span className="text-sm font-normal text-navy/40">/mois hors plan</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="mb-8 text-center text-xs text-navy/40">
          * Tarifs mensuels, hors frais de mise en service éventuels (facturés une seule fois,
          voir le détail sous chaque plan).
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
