import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/planning/dates";
import { parisDay, parisMidnightIso, parisMonthStartIso } from "@/lib/utils/paris-time";
import { fetchAllRows } from "@/lib/utils/fetch-all";
import { summarizeFuelRows, TRUSTED_FUEL_STATUSES, type FuelTotalsRow } from "@/lib/fuel/totals";
import { lireAgregats, type AgregatsDirection } from "@/lib/accueil/agregats";

export interface AgregatsAccueil extends AgregatsDirection {
  /** Repli sur l'ancien calcul : lignes trop nombreuses, totaux incomplets. */
  tronque: boolean;
}

/**
 * Coût carburant du mois, coût par véhicule (30 jours) et tournées par
 * service. D'abord la fonction SQL (aucune ligne ne quitte la base) ; si elle
 * n'existe pas encore, l'ancien calcul en JavaScript, mais avec les seules
 * colonnes utiles, bornées par période.
 */
export async function chargerAgregatsAccueil(supabase: SupabaseClient, p: { debutMois: string; depuis30j: string; bi: boolean }): Promise<AgregatsAccueil> {
  const { data, error } = await supabase.rpc("accueil_direction_agregats", { p_depuis_mois: p.debutMois, p_depuis_30j: p.depuis30j });
  const agregats = error ? null : lireAgregats(data);
  if (agregats) return { ...agregats, tronque: false };

  const [mois, carburant, tournees] = await Promise.all([
    fetchAllRows<FuelTotalsRow>((a, b) =>
      supabase.from("fuel_entries").select("liters, total_amount, status, product").in("status", [...TRUSTED_FUEL_STATUSES]).gte("occurred_at", p.debutMois).order("id").range(a, b),
    ),
    p.bi
      ? fetchAllRows<any>((a, b) =>
          supabase.from("fuel_entries").select("total_amount, vehicles(registration)").in("status", [...TRUSTED_FUEL_STATUSES]).gte("occurred_at", p.depuis30j).order("id").range(a, b),
        )
      : Promise.resolve({ rows: [] as any[], truncated: false, error: null }),
    p.bi
      ? fetchAllRows<any>((a, b) => supabase.from("planning_entries").select("services(name)").in("status", ["in_progress", "done"]).gte("start_at", p.depuis30j).order("id").range(a, b))
      : Promise.resolve({ rows: [] as any[], truncated: false, error: null }),
  ]);
  const parVehicule = new Map<string, number>();
  for (const r of carburant.rows) {
    const v = Array.isArray(r.vehicles) ? r.vehicles[0] : r.vehicles;
    parVehicule.set(v?.registration ?? "—", (parVehicule.get(v?.registration ?? "—") ?? 0) + Number(r.total_amount ?? 0));
  }
  const parService = new Map<string, number>();
  for (const r of tournees.rows) {
    const s = Array.isArray(r.services) ? r.services[0] : r.services;
    parService.set(s?.name ?? "—", (parService.get(s?.name ?? "—") ?? 0) + 1);
  }
  return {
    coutMois: summarizeFuelRows(mois.rows).cost,
    coutParVehicule: [...parVehicule].map(([name, value]) => ({ name, value: Math.round(value) })).sort((a, b) => b.value - a.value).slice(0, 8),
    tourneesParService: [...parService].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    tronque: mois.truncated || carburant.truncated || tournees.truncated,
  };
}

/** Une seule lecture des agrégats par requête (indicateurs et reporting de l'accueil). */
export const agregatsAccueilRequete = cache(async (_organisation: string, bi: boolean): Promise<AgregatsAccueil> =>
  chargerAgregatsAccueil(await createServerSupabaseClient(), { debutMois: parisMonthStartIso(), depuis30j: parisMidnightIso(addDays(parisDay(), -30)), bi }),
);
