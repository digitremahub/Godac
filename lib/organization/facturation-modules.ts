// Règles de facturation des modules, partagées par les routes serveur
// (onboarding, Modules & tarifs, Organisation). Fonctions pures, testées
// dans lib/organization/__tests__/facturation-modules.test.ts.
//
// Le plan et les modules payants ne s'activent que :
//   - pendant l'essai (organisation sans abonnement Stripe, statut
//     `trialing`) : c'est l'étape « modules » de l'onboarding, avant le
//     paiement ;
//   - ou par le webhook Stripe (app/api/webhooks/stripe), une fois payé.
// Les prix écrits viennent toujours de la grille (module_plan_prices) :
// jamais du client.

import { priceFor, type ModuleCatalogEntry, type ModulePlanPrice, type PlanId } from "@/lib/organization/catalog-types";

export interface EtatFacturation {
  subscription_status: string | null;
  stripe_subscription_id: string | null;
}

/** Essai gratuit : aucun abonnement Stripe encore souscrit. */
export function estEnEssai(org: EtatFacturation): boolean {
  return !org.stripe_subscription_id && (org.subscription_status ?? "trialing") === "trialing";
}

export interface LigneModule {
  organization_id: string;
  module_key: string;
  enabled: boolean;
  pricing_mode: "included" | "a_la_carte";
  effective_monthly_price: number;
  effective_setup_price: number;
}

/**
 * Lignes `organization_modules` pour un plan et une sélection : modules
 * inclus toujours actifs, modules à la carte actifs s'ils sont choisis,
 * prix tirés de la grille. Les modules V3 (non vendus) sont ignorés.
 */
export function calculerLignesModules(params: {
  organizationId: string;
  planId: PlanId;
  modules: ModuleCatalogEntry[];
  prices: ModulePlanPrice[];
  selection: ReadonlySet<string>;
  disponible: (moduleKey: string) => boolean;
}): LigneModule[] {
  const { organizationId, planId, modules, prices, selection, disponible } = params;
  return modules
    .filter((m) => m.wave !== "v3")
    .map((m) => {
      const price = priceFor(prices, m.key, planId);
      const included = price?.included ?? false;
      // Jamais activé (ni facturé) un module sans objet dans le pays de l'entreprise.
      const enabled = (included || selection.has(m.key)) && disponible(m.key);
      return {
        organization_id: organizationId,
        module_key: m.key,
        enabled,
        pricing_mode: included ? ("included" as const) : ("a_la_carte" as const),
        effective_monthly_price: enabled ? Number(price?.monthly_price ?? 0) : 0,
        effective_setup_price: enabled && !included ? Number(price?.setup_price ?? 0) : 0,
      };
    });
}

/** Un module est payant s'il n'est pas inclus et a un prix mensuel ou de mise en service. */
export function estPayant(ligne: Pick<LigneModule, "pricing_mode" | "effective_monthly_price" | "effective_setup_price">): boolean {
  return ligne.pricing_mode !== "included" && (ligne.effective_monthly_price > 0 || ligne.effective_setup_price > 0);
}

/**
 * Hors essai (abonnement Stripe en cours), seuls les modules payants déjà
 * actifs restent actifs : un module payant ne peut pas être ajouté sans
 * passer par Stripe. Renvoie les clés refusées.
 */
export function modulesPayantsAjoutes(lignes: LigneModule[], dejaActifs: ReadonlySet<string>): string[] {
  return lignes.filter((l) => l.enabled && estPayant(l) && !dejaActifs.has(l.module_key)).map((l) => l.module_key);
}
