import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";

export const RUN_FIELDS = "id, run_date, status, start_label, start_lat, start_lng, return_to_start, optimized_at";
export const STOP_FIELDS = "id, position, parcel_code, parcel_count, address, lat, lng, recipient, notes, status, done_at";

export function aujourdhuiParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

export async function moduleActif(supabase: SupabaseClient, organizationId: string) {
  return isModuleEnabled(supabase, organizationId, "route_optimizer");
}

/**
 * Tournée colis du jour du chauffeur, créée au besoin. Point de départ :
 * le dépôt de son premier service, sinon celui de l'entreprise.
 */
export async function tourneeDuJour(supabase: SupabaseClient, appUser: AppUser) {
  const date = aujourdhuiParis();
  const { data: existante } = await supabase.from("delivery_runs").select(RUN_FIELDS).eq("driver_id", appUser.id).eq("run_date", date).maybeSingle();
  if (existante) return existante;

  const [{ data: services }, { data: org }] = await Promise.all([
    supabase.from("user_services").select("services(name, depot_address, depot_lat, depot_lng)").eq("user_id", appUser.id),
    supabase.from("organizations").select("depot_address, depot_lat, depot_lng").eq("id", appUser.organization_id).single(),
  ]);
  const depot = ((services ?? []) as any[]).map((s) => s.services).find((s) => s?.depot_lat && s?.depot_lng);
  const start = depot
    ? { label: depot.depot_address ?? `Dépôt ${depot.name}`, lat: depot.depot_lat, lng: depot.depot_lng }
    : org?.depot_lat && org?.depot_lng
      ? { label: org.depot_address ?? "Dépôt", lat: org.depot_lat, lng: org.depot_lng }
      : null;

  const { data, error } = await supabase
    .from("delivery_runs")
    .insert({
      organization_id: appUser.organization_id,
      driver_id: appUser.id,
      run_date: date,
      start_label: start?.label ?? null,
      start_lat: start?.lat ?? null,
      start_lng: start?.lng ?? null,
    })
    .select(RUN_FIELDS)
    .single();
  if (error) {
    // Course entre deux onglets : la ligne existe déjà.
    const { data: again } = await supabase.from("delivery_runs").select(RUN_FIELDS).eq("driver_id", appUser.id).eq("run_date", date).single();
    return again;
  }
  return data;
}

/** Adresse normalisée pour regrouper plusieurs colis au même arrêt. */
export function cleAdresse(adresse: string): string {
  return adresse
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
