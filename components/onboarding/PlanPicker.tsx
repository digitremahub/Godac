"use client";

import type { Plan, PlanId } from "@/lib/organization/catalog-types";

export function PlanPicker({
  plans,
  selected,
  onChange,
}: {
  plans: Plan[];
  selected: PlanId;
  onChange: (next: PlanId) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      {plans.map((plan) => {
        const checked = plan.id === selected;
        return (
          <button
            key={plan.id}
            type="button"
            onClick={() => onChange(plan.id)}
            className={`card flex flex-col gap-2 text-left transition ${
              checked ? "border-teal/60 bg-teal/10" : "hover:border-white/20"
            }`}
          >
            <h3 className="text-base">{plan.name}</h3>
            <p className="font-display text-2xl font-extrabold text-teal">
              {plan.monthly_base_price} €<span className="text-sm font-normal text-white/40">/mois</span>
            </p>
            {plan.setup_price > 0 && (
              <p className="text-xs text-white/40">+ {plan.setup_price} € de mise en service</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
