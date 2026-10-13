import { describe, expect, it } from "vitest";
import { calculerDevis } from "@/lib/commercial/devis";
import type { ModuleCatalogEntry, ModulePlanPrice, Plan } from "@/lib/organization/catalog-types";

const pro: Plan = { id: "pro", name: "Pro", monthly_base_price: 699, setup_price: 990, setup_installments: 1, sort_order: 3, vehicle_min: 21, vehicle_max: 60, is_public: true };
const mod = (key: string, name: string): ModuleCatalogEntry => ({ key, name, description: "", wave: "v2", is_transverse: false, base_price: 0, included_from_plan: null, sort_order: 0 });
const modules = [mod("fuel_tracking", "Suivi Carburant"), mod("payslips", "Fiches de Paie"), mod("route_optimizer", "Tournée colis")];
const prices: ModulePlanPrice[] = [
  { module_key: "fuel_tracking", plan_id: "pro", monthly_price: 0, setup_price: 0, included: true },
  { module_key: "payslips", plan_id: "pro", monthly_price: 45, setup_price: 290, included: false },
  { module_key: "route_optimizer", plan_id: "pro", monthly_price: 29, setup_price: 0, included: false },
];

const starter: Plan = { id: "starter", name: "Starter", monthly_base_price: 249, setup_price: 600, setup_installments: 3, sort_order: 2, vehicle_min: 6, vehicle_max: 20, is_public: true };

describe("bon de commande", () => {
  it("Starter : mise en service échelonnée en 3 fois, sauf si offerte", () => {
    expect(calculerDevis(starter, [], [], []).echeances).toBe(3);
    expect(calculerDevis(starter, [], [], [], true).echeances).toBe(1);
  });
  it("formule + modules choisis, modules inclus listés à 0", () => {
    const d = calculerDevis(pro, modules, prices, ["payslips"]);
    expect(d.mensuelHT).toBe(744);
    expect(d.miseEnServiceHT).toBe(1280);
    expect(d.lignes.map((l) => l.libelle)).toEqual(["Formule Pro", "Suivi Carburant", "Fiches de Paie"]);
  });
  it("offre Fondateur : mise en service offerte", () => {
    const d = calculerDevis(pro, modules, prices, ["payslips"], true);
    expect(d.remiseFondateur).toBe(1280);
    expect(d.miseEnServiceNetHT).toBe(0);
  });
});
