import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { aujourdhuiParis, moduleActif } from "@/lib/colis/serveur";
import { parisCalendarDate, addDays } from "@/lib/planning/dates";

/**
 * Source de vérité pour l'ouverture d'une tournée chauffeur :
 * - chauffeur standard : tournée affectée dans le planning du jour ;
 * - chauffeur marqué renfort : choix limité aux tournées de ses services.
 * Les droits de mutation doivent rester vérifiés par les routes POST/PATCH.
 */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) {
    return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  }

  const [{ data: profile, error: profileError }, { data: links }, { data: entries, error: planningError }] = await Promise.all([
    supabase.from("users").select("is_renfort").eq("id", appUser.id).maybeSingle(),
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id),
    supabase.from("planning_entries").select("id, service_id, tour_number, start_at, end_at, status, vehicles(registration), services(name)")
      .eq("organization_id", appUser.organization_id)
      .eq("driver_id", appUser.id)
      .gte("start_at", `${addDays(aujourdhuiParis(), -1)}T12:00:00Z`)
      .lt("start_at", `${addDays(aujourdhuiParis(), 1)}T12:00:00Z`)
      .order("start_at"),
  ]);

  if (profileError) {
    return NextResponse.json({ error: "Impossible de lire la fiche chauffeur. Vérifiez la migration renfort." }, { status: 503 });
  }
  if (planningError) return NextResponse.json({ error: "Impossible de lire l'affectation du planning." }, { status: 500 });

  const today = aujourdhuiParis();
  const todayEntries = ((entries ?? []) as any[]).filter((entry) => parisCalendarDate(entry.start_at) === today);
  const assigned = todayEntries.find((entry) => entry.tour_number) ?? null;
  const serviceIds = [...new Set(((links ?? []) as { service_id: string }[]).map((x) => x.service_id))];
  const isRenfort = profile?.is_renfort === true;

  let renfortOptions: any[] = [];
  if (isRenfort && serviceIds.length) {
    const { data: routes, error } = await supabase.from("tour_routes")
      .select("id, tour_number, service_id, is_renfort, services(name), tour_route_villages(id, name, postal_code, position)")
      .eq("organization_id", appUser.organization_id)
      .in("service_id", serviceIds)
      .eq("is_renfort", true)
      .order("tour_number");
    if (error) return NextResponse.json({ error: "Impossible de charger les tournées de renfort." }, { status: 500 });
    renfortOptions = (routes ?? []).map((route: any) => ({
      id: route.id,
      tour_number: route.tour_number,
      service_id: route.service_id,
      service_name: route.services?.name ?? null,
      villages: (route.tour_route_villages ?? []).sort((a: any, b: any) => a.position - b.position),
    }));
  }

  return NextResponse.json({
    mode: isRenfort ? "renfort" : "planning",
    assigned: assigned ? {
      planning_entry_id: assigned.id,
      tour_number: assigned.tour_number,
      service_id: assigned.service_id,
      service_name: assigned.services?.name ?? null,
      vehicle: assigned.vehicles?.registration ?? null,
      start_at: assigned.start_at,
      end_at: assigned.end_at,
      status: assigned.status,
    } : null,
    service_ids: serviceIds,
    renfort_options: renfortOptions,
  });
}
