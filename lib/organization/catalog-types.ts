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
  sort_order: number;
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
  included: boolean;
}

export function priceFor(prices: ModulePlanPrice[], moduleKey: string, planId: PlanId): ModulePlanPrice | undefined {
  return prices.find((p) => p.module_key === moduleKey && p.plan_id === planId);
}
