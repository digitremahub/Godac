"use client";
import { estModuleVendable } from "@/lib/acces/catalogue";

import Link from "next/link";
import { useState } from "react";
import { PlanPicker } from "@/components/onboarding/PlanPicker";
import { ModuleSelector } from "@/components/onboarding/ModuleSelector";
import { libelleMiseEnService, priceFor, type Plan, type ModuleCatalogEntry, type ModulePlanPrice, type PlanId } from "@/lib/organization/catalog-types";
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
    .filter(estModuleVendable)
    .map((m) => ({ module: m, price: priceFor(prices, m.key, planId) }))
    .filter((x) => !x.price?.included && selected.has(x.module.key));
  const addonsTotal = selectedAddons.reduce((sum, x) => sum + Number(x.price?.monthly_price ?? 0), 0);
  const addonsSetupTotal = selectedAddons.reduce((sum, x) => sum + Number(x.price?.setup_price ?? 0), 0);
  const total = (plan?.monthly_base_price ?? 0) + addonsTotal;
  const setupTotal = (plan?.setup_price ?? 0) + addonsSetupTotal;
  const firstYearTotal = setupTotal + total * 12;
  const yearTwoTotal = total * 12;
  const euro = (value: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
  const selection = new URLSearchParams({ plan: planId, modules: selectedAddons.map((x) => x.module.key).join(",") }).toString();

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

      <Card className="flex flex-col gap-5 border-teal/30 bg-teal/5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-navy/70">Abonnement mensuel · plan {plan?.name}</p>
            <p className="text-3xl font-bold tabular-nums text-teal-ink">
              {euro(total)}<span className="text-base font-normal text-navy/60">/mois HT</span>
            </p>
          </div>
          <p className="text-sm text-navy/70">Mise en service : <span className="font-semibold text-navy">{euro(setupTotal)}</span> HT</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-navy/10 bg-white/70 p-3">
            <p className="text-xs text-navy/60">Coût total année 1</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-navy">{euro(firstYearTotal)} HT</p>
            <p className="mt-1 text-xs text-navy/60">Mise en service + 12 mensualités</p>
          </div>
          <div className="rounded-lg border border-navy/10 bg-white/70 p-3">
            <p className="text-xs text-navy/60">Équivalent mensuel année 1</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-navy">{euro(firstYearTotal / 12)} HT/mois</p>
            <p className="mt-1 text-xs text-navy/60">Pour comparer les offres à périmètre égal</p>
          </div>
          <div className="rounded-lg border border-navy/10 bg-white/70 p-3">
            <p className="text-xs text-navy/60">Coût récurrent année 2</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-navy">{euro(yearTwoTotal)} HT</p>
            <p className="mt-1 text-xs text-navy/60">Abonnement sur 12 mois, hors usage éventuel</p>
          </div>
        </div>
        {setupTotal > 0 && (
          <p className="text-xs text-navy/60">
            La mise en service est facturée une seule fois. {plan && plan.setup_installments > 1 ? `Le tarif du plan prévoit un paiement en ${plan.setup_installments} fois.` : "Elle couvre le paramétrage et le démarrage selon le périmètre retenu."}
            Les consommations hors forfait éventuelles sont indiquées séparément dans le catalogue.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href={`/contact?${selection}`} className="btn-primary">
            Construire mon offre premium
          </Link>
          <Link href={`/bon-de-commande?${selection}`} className="btn-secondary">
            Voir le bon de commande
          </Link>
          <Link href="/sign-up" className="btn-ghost">
            Créer mon organisation
          </Link>
        </div>
      </Card>
    </div>
  );
}
