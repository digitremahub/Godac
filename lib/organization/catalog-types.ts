// Pure types + helpers shared between server data access
// (lib/organization/catalog.ts, server-only) and client components
// (onboarding wizard, module selector) that need to price a catalog
// already fetched server-side and passed down as props.

export type PlanId = "essentiel" | "starter" | "pro" | "business";
export type ModuleWave = "v1" | "v2" | "v3";

export interface Plan {
  id: PlanId;
  name: string;
  monthly_base_price: number;
  setup_price: number;
  /** Mise en service payable en N mensualités (1 = à la commande). */
  setup_installments: number;
  sort_order: number;
  vehicle_min: number;
  vehicle_max: number | null;
  is_public: boolean;
}

export interface ModuleCatalogEntry {
  key: string;
  name: string;
  description: string;
  wave: ModuleWave;
  is_transverse: boolean;
  base_price: number;
  included_from_plan: PlanId | null;
  sort_order: number;
}

export interface ModulePlanPrice {
  module_key: string;
  plan_id: PlanId;
  monthly_price: number;
  setup_price: number;
  included: boolean;
}

export function priceFor(prices: ModulePlanPrice[], moduleKey: string, planId: PlanId): ModulePlanPrice | undefined {
  return prices.find((p) => p.module_key === moduleKey && p.plan_id === planId);
}

/** « 600 € » ou « 600 € en 3 × 200 € » selon l'échelonnement de la formule. */
export function libelleMiseEnService(plan: Pick<Plan, "setup_price" | "setup_installments">): string {
  const total = Number(plan.setup_price);
  const n = Math.max(1, plan.setup_installments ?? 1);
  const fmt = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/[\u202f\u00a0]/g, " ");
  return n > 1 ? `${fmt(total)} € payables en ${n} × ${fmt(Math.round((total / n) * 100) / 100)} €` : `${fmt(total)} €`;
}
