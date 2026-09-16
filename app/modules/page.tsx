import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getFullCatalog, priceFor, type PlanId } from "@/lib/organization/catalog";

export const metadata = {
  title: "Modules & tarifs — GODAC",
};

const WAVE_LABELS: Record<string, string> = {
  v1: "Disponible aujourd'hui",
  v2: "Disponible aujourd'hui (upsell)",
  v3: "Bientôt disponible",
};

/**
 * Public presentation page (no auth required): the 4 plans and the
 * full 21-module catalogue, both à la carte and per-plan. Numbers
 * here read live from plans/modules/module_plan_prices (see
 * supabase/migrations/20260101000015_module_catalog.sql), the same
 * tables onboarding actually charges from — nothing to keep in sync
 * by hand.
 */
export default async function ModulesPage() {
  const supabase = await createServerSupabaseClient();
  const { plans, modules, prices } = await getFullCatalog(supabase);

  const v1v2Modules = modules.filter((m) => m.wave === "v1" || m.wave === "v2");
  const v3Modules = modules.filter((m) => m.wave === "v3");
  const planName = (id: PlanId | null) => (id ? plans.find((p) => p.id === id)?.name ?? id : null);

  return (
    <main className="min-h-screen bg-navy px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <span className="badge-teal mb-4 inline-block">4 plans + modules à la carte</span>
          <h1 className="text-4xl md:text-5xl">Choisissez votre plan, ajoutez ce dont vous avez besoin</h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/60">
            Chaque plan inclut un socle de modules ; tout module non inclus reste activable à la
            carte, au prix indiqué ci-dessous.
          </p>
        </div>

        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-4">
          {plans.map((plan) => (
            <div key={plan.id} className="card flex flex-col gap-2">
              <h2 className="text-xl">{plan.name}</h2>
              <p className="font-display text-3xl font-extrabold text-teal">
                {plan.monthly_base_price} €<span className="text-sm font-normal text-white/40">/mois</span>
              </p>
              {plan.setup_price > 0 && (
                <p className="text-xs text-white/40">+ {plan.setup_price} € de mise en service</p>
              )}
            </div>
          ))}
        </div>

        <h2 className="mb-4 text-xl text-white/80">Modules — {WAVE_LABELS.v1}</h2>
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {v1v2Modules.map((m) => {
            const includedPlan = planName(m.included_from_plan);
            return (
              <div key={m.key} className="card flex flex-col gap-3">
                <h3 className="text-lg">{m.name}</h3>
                <p className="flex-1 text-sm text-white/60">{m.description}</p>
                {includedPlan ? (
                  <p className="text-sm text-teal">Inclus dès le plan {includedPlan}</p>
                ) : (
                  <p className="text-sm text-white/40">Jamais inclus dans un plan — à la carte uniquement</p>
                )}
                {m.base_price > 0 && (
                  <p className="font-display text-xl font-extrabold text-gold">
                    +{m.base_price} €<span className="text-sm font-normal text-white/40">/mois hors plan</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {v3Modules.length > 0 && (
          <>
            <h2 className="mb-4 text-xl text-white/80">{WAVE_LABELS.v3}</h2>
            <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {v3Modules.map((m) => (
                <div key={m.key} className="card flex flex-col gap-2 opacity-60">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base">{m.name}</h3>
                    <span className="badge-neutral">Bientôt</span>
                  </div>
                  <p className="text-sm text-white/50">{m.description}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="text-center">
          <Link href="/sign-up" className="btn-primary">
            Créer mon organisation
          </Link>
        </div>
      </div>
    </main>
  );
}
