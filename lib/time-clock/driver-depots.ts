import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Coordinates } from "@/lib/business/fuel-profitability";

/**
 * Builds a per-driver list of "at the depot" candidate coordinates —
 * each service a driver is qualified on (user_services) can have its
 * own depot (services.depot_lat/lng), with the organisation-wide one
 * (organizations.depot_lat/lng) always included too as a shared
 * fallback/extra candidate. Used by classifyLocation (badge history,
 * /time-clock) and the planning-start/badge-end payroll rule
 * (/equipe/paie/heures) — both need "did this badge happen at a depot", not
 * "which exact depot".
 */
export async function buildDriverDepotsMap(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ depotsFor: (userId: string) => Coordinates[] }> {
  const [{ data: organization }, { data: userServices }] = await Promise.all([
    supabase.from("organizations").select("depot_lat, depot_lng").eq("id", organizationId).single(),
    supabase.from("user_services").select("user_id, services(depot_lat, depot_lng)"),
  ]);

  const orgDepot: Coordinates | null =
    organization?.depot_lat !== null && organization?.depot_lat !== undefined && organization?.depot_lng !== null && organization?.depot_lng !== undefined
      ? { lat: Number(organization.depot_lat), lng: Number(organization.depot_lng) }
      : null;

  const map = new Map<string, Coordinates[]>();
  for (const row of (userServices ?? []) as any[]) {
    if (!row.user_id) continue;
    const list = map.get(row.user_id) ?? (orgDepot ? [orgDepot] : []);
    const svc = Array.isArray(row.services) ? row.services[0] : row.services;
    if (svc?.depot_lat !== null && svc?.depot_lat !== undefined && svc?.depot_lng !== null && svc?.depot_lng !== undefined) {
      list.push({ lat: Number(svc.depot_lat), lng: Number(svc.depot_lng) });
    }
    map.set(row.user_id, list);
  }

  return { depotsFor: (userId: string) => map.get(userId) ?? (orgDepot ? [orgDepot] : []) };
}
