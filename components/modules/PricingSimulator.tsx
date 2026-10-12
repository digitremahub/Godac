"use client";

import Link from "next/link";
import { useState } from "react";
import { PlanPicker } from "@/components/onboarding/PlanPicker";
import { ModuleSelector } from "@/components/onboarding/ModuleSelector";
import { priceFor, type Plan, type ModuleCatalogEntry, type ModulePlanPrice, type PlanId } from "@/lib/organization/catalog-types";
import { Card } from "@/components/ui";

/**
 * Public-facing pricing simulator: the same PlanPicker/ModuleSelector
 * used post-signup in onboarding, reused here so a prospect can play
 * with plan + module combinations before creating an account — the
 * total always matches what onboarding/Stripe will actually charge,
 * since both read the same plans/modules/module_plan_prices tables.
 */
export function PricingSimulator({
  plans,
  modules,
  prices,
}: {
  plans: Plan[];
  modules: ModuleCatalogEntry[];
  prices: ModulePlanPrice[];
}) {
  const [planId, setPlanId] = useState<PlanId>(plans[0]?.id ?? "starter");
  const [selectedModuleKeys, setSelectedModuleKeys] = useState<string[]>([]);

  const plan = plans.find((p) => p.id === planId);
  const selected = new Set(selectedModuleKeys);
  const selectedAddons = modules
    .filter((m) => m.wave !== "v3")
    .map((m) => ({ module: m, price: priceFor(prices, m.key, planId) }))
    .filter((x) => !x.price?.included && selected.has(x.module.key));
  const addonsTotal = selectedAddons.reduce((sum, x) => sum + Number(x.price?.monthly_price ?? 0), 0);
  const addonsSetupTotal = selectedAddons.reduce((sum, x) => sum + Number(x.price?.setup_price ?? 0), 0);
  const total = (plan?.monthly_base_price ?? 0) + addonsTotal;
  const setupTotal = (plan?.setup_price ?? 0) + addonsSetupTotal;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-sm text-navy/70">1. Choisissez votre plan</p>
        <PlanPicker plans={plans} selected={planId} onChange={setPlanId} />
      </div>

      <div>
        <p className="mb-2 text-sm text-navy/70">2. Ajoutez des modules complémentaires</p>
        <ModuleSelector modules={modules} prices={prices} planId={planId} selected={selectedModuleKeys} onChange={setSelectedModuleKeys} />
      </div>

      <Card className="flex flex-col gap-3 border-teal/30 bg-teal/5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-navy/70">Estimation pour le plan {plan?.name}</p>
          <p className="text-3xl font-bold tabular-nums text-teal-ink">
            {total.toFixed(2)} €{setupTotal > 0 ? "*" : ""}
            <span className="text-base font-normal text-navy/60">/mois</span>
          </p>
          {setupTotal > 0 && (
            <p className="text-xs text-navy/60">* + {setupTotal.toFixed(2)} € de mise en service, une seule fois</p>
          )}
        </div>
        <Link href="/sign-up" className="btn-primary shrink-0">
          Créer mon organisation
        </Link>
      </Card>
    </div>
  );
}
