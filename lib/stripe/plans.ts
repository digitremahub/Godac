export interface Plan {
  id: "starter" | "pro";
  name: string;
  priceEnvVar: "NEXT_PUBLIC_STRIPE_PRICE_STARTER" | "NEXT_PUBLIC_STRIPE_PRICE_PRO";
  description: string;
  features: string[];
}

/**
 * Flat per-organisation monthly pricing for the MVP. Per-chauffeur
 * modular pricing is a Phase 2 item (see README) and would replace
 * the flat `priceEnvVar` lookup with a Stripe metered/seat price.
 */
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    priceEnvVar: "NEXT_PUBLIC_STRIPE_PRICE_STARTER",
    description: "Jusqu'à 20 véhicules, module OCR inclus.",
    features: ["Carburant + OCR", "Flotte", "Alertes", "Export TICPE"],
  },
  {
    id: "pro",
    name: "Pro",
    priceEnvVar: "NEXT_PUBLIC_STRIPE_PRICE_PRO",
    description: "Flotte illimitée, multi-services, support prioritaire.",
    features: ["Tout Starter", "Multi-services", "Planning & RH (Phase 2)", "Support prioritaire"],
  },
];

export function getPlanPriceId(plan: Plan): string | undefined {
  return process.env[plan.priceEnvVar];
}
