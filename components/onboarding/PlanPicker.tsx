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
              checked ? "border-teal/60 bg-teal/10" : "hover:border-navy/20"
            }`}
          >
            <h3 className="text-base">{plan.name}</h3>
            <p className="text-xs text-navy/65">
              {plan.vehicle_max ? `${plan.vehicle_min}–${plan.vehicle_max} véhicules` : `${plan.vehicle_min}+ véhicules`}
            </p>
            <p className="font-display text-2xl font-extrabold text-teal-ink">
              {plan.monthly_base_price} €{plan.setup_price > 0 ? "*" : ""}
              <span className="text-sm font-normal text-navy/60">/mois</span>
            </p>
            {plan.setup_price > 0 && (
              <p className="text-xs text-navy/60">* + {plan.setup_price} € de mise en service, une seule fois</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
