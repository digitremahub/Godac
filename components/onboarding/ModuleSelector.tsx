"use client";

import type { ModuleCatalogEntry, ModulePlanPrice, PlanId } from "@/lib/organization/catalog-types";
import { priceFor } from "@/lib/organization/catalog-types";
import { Card } from "@/components/ui";

/**
 * Renders every V1/V2 module against the currently selected plan:
 * modules the plan already bundles show as included (always on, no
 * toggle), everything else is an optional à-la-carte add-on priced
 * per module_plan_prices (base price + 40%, see migration 15). V3
 * modules are documentation-only for now and never offered here.
 */
export function ModuleSelector({
  modules,
  prices,
  planId,
  selected,
  onChange,
}: {
  modules: ModuleCatalogEntry[];
  prices: ModulePlanPrice[];
  planId: PlanId;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const sellable = modules.filter((m) => m.wave !== "v3");
  const withPrice = sellable.map((m) => ({ module: m, price: priceFor(prices, m.key, planId) }));
  const included = withPrice.filter((x) => x.price?.included);
  const addons = withPrice.filter((x) => !x.price?.included);

  function toggle(key: string) {
    onChange(selected.includes(key) ? selected.filter((x) => x !== key) : [...selected, key]);
  }

  const addonsTotal = addons
    .filter((a) => selected.includes(a.module.key))
    .reduce((sum, a) => sum + Number(a.price?.monthly_price ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      {included.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-navy/50">Inclus dans votre plan</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {included.map(({ module }) => (
              <div key={module.key} className="card flex flex-col gap-2 border-teal/30 bg-teal/5">
                <div className="flex items-center justify-between">
                  <h3 className="text-base">{module.name}</h3>
                  <span className="badge-teal">Inclus</span>
                </div>
                <p className="text-sm text-navy/60">{module.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {addons.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-navy/50">Modules complémentaires (à la carte)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {addons.map(({ module, price }) => {
              const checked = selected.includes(module.key);
              return (
                <button
                  key={module.key}
                  type="button"
                  onClick={() => toggle(module.key)}
                  className={`card flex flex-col gap-2 text-left transition ${
                    checked ? "border-teal/60 bg-teal/10" : "hover:border-navy/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base">{module.name}</h3>
                    <span className={checked ? "badge-teal" : "badge-neutral"}>
                      {checked ? "Activé" : `+${price?.monthly_price ?? 0} €`}
                    </span>
                  </div>
                  <p className="text-sm text-navy/60">{module.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Card className="flex flex-col gap-2">
        <div className="flex justify-between text-sm text-navy/60">
          <span>Modules complémentaires sélectionnés</span>
          <span>{addonsTotal.toFixed(2)} €/mois</span>
        </div>
      </Card>
    </div>
  );
}
