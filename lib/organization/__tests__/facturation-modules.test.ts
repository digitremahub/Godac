import { describe, expect, it } from "vitest";
import { calculerLignesModules, estEnEssai, modulesPayantsAjoutes } from "@/lib/organization/facturation-modules";
import type { ModuleCatalogEntry, ModulePlanPrice } from "@/lib/organization/catalog-types";

const mod = (key: string, wave: "v1" | "v2" | "v3" = "v2"): ModuleCatalogEntry => ({
  key,
  name: key,
  description: "",
  wave,
  is_transverse: false,
  base_price: 0,
  included_from_plan: null,
  sort_order: 0,
});
const modules = [mod("fleet", "v1"), mod("payslips"), mod("ticpe_export", "v1"), mod("tachograph", "v3")];
const prices: ModulePlanPrice[] = [
  { module_key: "fleet", plan_id: "starter", monthly_price: 0, setup_price: 0, included: true },
  { module_key: "payslips", plan_id: "starter", monthly_price: 35, setup_price: 350, included: false },
  { module_key: "ticpe_export", plan_id: "starter", monthly_price: 99, setup_price: 990, included: false },
];

describe("calculerLignesModules", () => {
  it("prend les prix de la grille et ignore les modules V3", () => {
    const lignes = calculerLignesModules({
      organizationId: "org",
      planId: "starter",
      modules,
      prices,
      selection: new Set(["payslips", "tachograph"]),
      disponible: () => true,
    });
    expect(lignes.map((l) => l.module_key)).toEqual(["fleet", "payslips", "ticpe_export"]);
    expect(lignes[0]).toMatchObject({ enabled: true, pricing_mode: "included", effective_monthly_price: 0 });
    expect(lignes[1]).toMatchObject({ enabled: true, pricing_mode: "a_la_carte", effective_monthly_price: 35, effective_setup_price: 350 });
    expect(lignes[2]).toMatchObject({ enabled: false, effective_monthly_price: 0 });
  });

  it("n'active pas un module indisponible dans le pays", () => {
    const lignes = calculerLignesModules({
      organizationId: "org",
      planId: "starter",
      modules,
      prices,
      selection: new Set(["ticpe_export"]),
      disponible: (k) => k !== "ticpe_export",
    });
    expect(lignes.find((l) => l.module_key === "ticpe_export")?.enabled).toBe(false);
  });
});

describe("essai et ajout de modules payants", () => {
  it("essai = statut trialing sans abonnement Stripe", () => {
    expect(estEnEssai({ subscription_status: "trialing", stripe_subscription_id: null })).toBe(true);
    expect(estEnEssai({ subscription_status: "trialing", stripe_subscription_id: "sub_1" })).toBe(false);
    expect(estEnEssai({ subscription_status: "active", stripe_subscription_id: null })).toBe(false);
  });

  it("hors essai, refuse l'ajout d'un module payant, accepte ceux déjà actifs", () => {
    const lignes = calculerLignesModules({
      organizationId: "org",
      planId: "starter",
      modules,
      prices,
      selection: new Set(["payslips", "ticpe_export"]),
      disponible: () => true,
    });
    expect(modulesPayantsAjoutes(lignes, new Set(["fleet", "payslips"]))).toEqual(["ticpe_export"]);
    expect(modulesPayantsAjoutes(lignes, new Set(["payslips", "ticpe_export"]))).toEqual([]);
  });
});
