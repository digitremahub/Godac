import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFleetConsumptionRanking, getVehicleConsumption } from "@/lib/vehicles/consumption";

const jour = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

/** Faux client : chaque table renvoie ses lignes, filtrées par véhicule si demandé ; compte les requêtes. */
function fauxClient(tables: Record<string, Record<string, unknown>[]>) {
  let requetes = 0;
  const client = {
    from(table: string) {
      requetes++;
      let lignes = tables[table] ?? [];
      const b: Record<string, unknown> = {};
      for (const m of ["select", "gte", "or", "not", "order", "range", "lt"]) b[m] = () => b;
      b.in = (col: string, vals: unknown[]) => {
        if (col === "vehicle_id") lignes = lignes.filter((l) => vals.includes(l.vehicle_id));
        return b;
      };
      b.eq = (col: string, val: unknown) => {
        if (col === "vehicle_id") lignes = lignes.filter((l) => l.vehicle_id === val);
        return b;
      };
      b.then = (ok: (r: unknown) => unknown) => ok({ data: lignes, error: null });
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, requetes: () => requetes };
}

describe("consommation de la flotte en une série de requêtes", () => {
  const tables = {
    fuel_entries: [
      { vehicle_id: "v1", liters: 30, occurred_at: jour(10), vehicle_km: 1000, product: "gazole" },
      { vehicle_id: "v1", liters: 40, occurred_at: jour(2), vehicle_km: 1500, product: "gazole" },
      { vehicle_id: "v2", liters: 50, occurred_at: jour(9), vehicle_km: 2000, product: "gazole" },
      { vehicle_id: "v2", liters: 60, occurred_at: jour(1), vehicle_km: 2200, product: "gazole" },
      { vehicle_id: "v2", liters: 5, occurred_at: jour(1), vehicle_km: null, product: "adblue" },
    ],
    planning_entries: [{ vehicle_id: "v1", start_at: jour(5), start_km: 1200, end_at: jour(5), end_km: 1300 }],
    vehicle_interventions: [],
  };
  const flotte = [
    { id: "v1", registration: "AA-111-AA" },
    { id: "v2", registration: "BB-222-BB" },
    { id: "v3", registration: "CC-333-CC" },
  ];

  it("même classement que le calcul véhicule par véhicule", async () => {
    const { client, requetes } = fauxClient(tables);
    const classement = await getFleetConsumptionRanking(client, flotte, 30);
    expect(requetes()).toBe(3);
    const unParUn = await Promise.all(flotte.map(async (v) => ({ registration: v.registration, consumption: await getVehicleConsumption(fauxClient(tables).client, v.id, 30) })));
    const attendu = unParUn.filter((v) => v.consumption !== null).sort((a, b) => b.consumption! - a.consumption!);
    expect(classement).toEqual(attendu);
    expect(classement.map((v) => v.registration)).toEqual(["BB-222-BB", "AA-111-AA"]);
  });

  it("flotte vide : aucune requête", async () => {
    const { client, requetes } = fauxClient(tables);
    expect(await getFleetConsumptionRanking(client, [], 30)).toEqual([]);
    expect(requetes()).toBe(0);
  });
});
