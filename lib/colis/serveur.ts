import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";
import { isModuleEnabled } from "@/lib/organization/modules";

export const RUN_FIELDS = "id, name, run_date, status, start_label, start_lat, start_lng, return_to_start, optimized_at";
export const STOP_FIELDS = "id, position, parcel_code, parcel_count, address, lat, lng, recipient, notes, status, done_at";

export function aujourdhuiParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

export async function moduleActif(supabase: SupabaseClient, organizationId: string) {
  return isModuleEnabled(supabase, organizationId, "route_optimizer");
}

/** Point de départ par défaut : dépôt du premier service du chauffeur, sinon celui de l'entreprise. */
async function depotDuChauffeur(supabase: SupabaseClient, appUser: AppUser) {
  const [{ data: services }, { data: org }] = await Promise.all([
    supabase.from("user_services").select("services(name, depot_address, depot_lat, depot_lng)").eq("user_id", appUser.id),
    supabase.from("organizations").select("depot_address, depot_lat, depot_lng").eq("id", appUser.organization_id).single(),
  ]);
  const depot = ((services ?? []) as any[]).map((s) => s.services).find((s) => s?.depot_lat && s?.depot_lng);
  if (depot) return { label: depot.depot_address ?? `Dépôt ${depot.name}`, lat: depot.depot_lat, lng: depot.depot_lng };
  if (org?.depot_lat && org?.depot_lng) return { label: org.depot_address ?? "Dépôt", lat: org.depot_lat, lng: org.depot_lng };
  return null;
}

/**
 * Tournées colis du chauffeur à afficher : celles du jour, plus celles
 * des 7 derniers jours qui ne sont pas clôturées.
 */
export async function listerTournees(supabase: SupabaseClient, appUser: AppUser) {
  const today = aujourdhuiParis();
  const semaine = new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("delivery_runs")
    .select(`${RUN_FIELDS}, delivery_stops(parcel_count, status)`)
    .eq("driver_id", appUser.id)
    .gte("run_date", semaine)
    .order("run_date")
    .order("created_at");
  return ((data ?? []) as any[])
    .filter((r) => r.run_date === today || r.status !== "done")
    .map(({ delivery_stops, ...r }) => ({
      ...r,
      nbArrets: (delivery_stops ?? []).length,
      nbColis: (delivery_stops ?? []).reduce((n: number, s: any) => n + s.parcel_count, 0),
      nbRestants: (delivery_stops ?? []).filter((s: any) => s.status === "pending").length,
    }));
}

export async function creerTournee(supabase: SupabaseClient, appUser: AppUser, name: string | null) {
  const date = aujourdhuiParis();
  const start = await depotDuChauffeur(supabase, appUser);
  const { count } = await supabase.from("delivery_runs").select("id", { count: "exact", head: true }).eq("driver_id", appUser.id).eq("run_date", date);
  const { data, error } = await supabase
    .from("delivery_runs")
    .insert({
      organization_id: appUser.organization_id,
      driver_id: appUser.id,
      run_date: date,
      name: name?.trim() || `Tournée ${(count ?? 0) + 1}`,
      start_label: start?.label ?? null,
      start_lat: start?.lat ?? null,
      start_lng: start?.lng ?? null,
    })
    .select(RUN_FIELDS)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Une tournée du chauffeur connecté (jamais celle d'un autre). */
export async function tourneeParId(supabase: SupabaseClient, appUser: AppUser, id: string) {
  const { data } = await supabase.from("delivery_runs").select(RUN_FIELDS).eq("id", id).eq("driver_id", appUser.id).maybeSingle();
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
