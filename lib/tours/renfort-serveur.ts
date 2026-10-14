import "server-only";
import type { createServerSupabaseClient } from "@/lib/supabase/server";
import { renfortCandidates, type RenfortRoute } from "@/lib/tours/renfort";

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Le renfort et les tournées dont il peut emprunter les villages (lus avec les droits de l'utilisateur). */
export async function loadRenfortContext(supabase: Supabase, routeId: string) {
  const { data: renfort, error } = await supabase.from("tour_routes").select("id, tour_number, service_id, is_renfort").eq("id", routeId).maybeSingle();
  if (error) return { error: "Tournées de renfort indisponibles (mise à jour de la base en attente).", status: 503 as const };
  if (!renfort) return { error: "Tournée introuvable.", status: 404 as const };
  if (!renfort.is_renfort) return { error: "Cette tournée n'est pas une tournée de renfort.", status: 400 as const };
  const { data: routes } = await supabase.from("tour_routes").select("id, tour_number, service_id, is_renfort, tour_route_villages(id)");
  const all: RenfortRoute[] = ((routes ?? []) as any[]).map((r) => ({
    id: r.id,
    tourNumber: r.tour_number,
    serviceId: r.service_id,
    isRenfort: Boolean(r.is_renfort),
    villages: (r.tour_route_villages ?? []) as { id: string }[],
  }));
  return {
    renfort: renfort as { id: string; tour_number: string; service_id: string | null; is_renfort: boolean },
    candidates: renfortCandidates(all, { id: renfort.id, serviceId: renfort.service_id }),
  };
}
