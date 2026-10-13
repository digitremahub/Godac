import { describe, expect, it } from "vitest";
import { calculerDevis } from "@/lib/commercial/devis";
import type { ModuleCatalogEntry, ModulePlanPrice, Plan } from "@/lib/organization/catalog-types";

const pro: Plan = { id: "pro", name: "Pro", monthly_base_price: 699, setup_price: 7490, sort_order: 3, vehicle_min: 20, vehicle_max: 60, is_public: true };
const mod = (key: string, name: string): ModuleCatalogEntry => ({ key, name, description: "", wave: "v2", is_transverse: false, base_price: 0, included_from_plan: null, sort_order: 0 });
const modules = [mod("fuel_tracking", "Suivi Carburant"), mod("payslips", "Fiches de Paie"), mod("route_optimizer", "Tournée colis")];
const prices: ModulePlanPrice[] = [
  { module_key: "fuel_tracking", plan_id: "pro", monthly_price: 0, setup_price: 0, included: true },
  { module_key: "payslips", plan_id: "pro", monthly_price: 45, setup_price: 450, included: false },
  { module_key: "route_optimizer", plan_id: "pro", monthly_price: 29, setup_price: 0, included: false },
];

describe("bon de commande", () => {
  it("formule + modules choisis, modules inclus listés à 0", () => {
    const d = calculerDevis(pro, modules, prices, ["payslips"]);
    expect(d.mensuelHT).toBe(744);
    expect(d.miseEnServiceHT).toBe(7940);
    expect(d.lignes.map((l) => l.libelle)).toEqual(["Formule Pro", "Suivi Carburant", "Fiches de Paie"]);
  });
  it("offre Fondateur : −3 000 € de mise en service en Pro", () => {
    const d = calculerDevis(pro, modules, prices, [], true);
    expect(d.remiseFondateur).toBe(3000);
    expect(d.miseEnServiceNetHT).toBe(4490);
  });
});
