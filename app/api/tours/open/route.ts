import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { resolveTourActor } from "@/lib/tours/on-behalf";

/**
 * The signed-in driver's own currently open tour, if any — used by
 * both the start flow (to block opening a second one) and the end
 * flow (to find what to close out and check it matches the scanned
 * vehicle). Also returns today's still-"planned" entry, if a manager
 * already planned one — StartTourFlow pre-fills from it and passes
 * its id back explicitly, so opening the tour updates that same row
 * (see app/api/tours/route.ts) instead of relying on the driver
 * retyping a matching tour number.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  // Same endpoint for « J'entre pour un collègue »: with a valid on-behalf
  // token this answers for the colleague instead (lib/tours/on-behalf.ts).
  const actor = await resolveTourActor(req, appUser);
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const { db: supabase, driverId } = actor;

  // "Today" as the driver lives it: a window around now rather than the
  // server's UTC midnight, so an early-morning Paris tour still matches.
  const todayStart = new Date(Date.now() - 14 * 3600_000);
  const todayEnd = new Date(Date.now() + 14 * 3600_000);

  const [openRes, plannedRes, qualificationsRes, assignedRes, lastTourRes] = await Promise.all([
    supabase
      .from("planning_entries")
      .select("id, tour_number, start_at, start_km, vehicles(id, registration)")
      .eq("organization_id", appUser.organization_id)
      .eq("driver_id", driverId)
      .eq("status", "in_progress")
      .maybeSingle(),
    supabase
      .from("planning_entries")
      .select("id, tour_number, start_at, vehicles(id, registration)")
      .eq("organization_id", appUser.organization_id)
      .eq("driver_id", driverId)
      .eq("status", "planned")
      .gte("start_at", todayStart.toISOString())
      .lt("start_at", todayEnd.toISOString())
      .order("start_at")
      .limit(1),
    // A driver qualified on 2+ services is polyvalent between them —
    // StartTourFlow shows them a service picker only in that case
    // (see app/api/tours POST's own comment on why the service
    // otherwise just follows the scanned vehicle).
    supabase.from("user_services").select("services(id, name)").eq("user_id", driverId),
    // The truck this driver is assigned to (Flotte > véhicule >
    // « Chauffeur assigné ») — StartTourFlow pre-selects it so a
    // driver with their own truck never has to scan its QR.
    supabase
      .from("vehicles")
      .select("id, registration")
      .eq("organization_id", appUser.organization_id)
      .eq("assigned_driver_id", driverId)
      .eq("status", "active")
      .limit(1),
    // The driver's usual tour number (e.g. T106) — prefilled when
    // nothing is planned today, instead of an automatic number.
    supabase
      .from("planning_entries")
      .select("tour_number")
      .eq("organization_id", appUser.organization_id)
      .eq("driver_id", driverId)
      .in("status", ["in_progress", "done"])
      .not("tour_number", "like", "________-%")
      .order("start_at", { ascending: false })
      .limit(1),
  ]);

  if (openRes.error) return NextResponse.json({ error: openRes.error.message }, { status: 500 });
  const qualifiedServices = ((qualificationsRes.data ?? []) as any[]).map((r) => r.services).filter(Boolean);
  return NextResponse.json({
    tour: openRes.data,
    plannedToday: plannedRes.data?.[0] ?? null,
    assignedVehicle: assignedRes.data?.[0] ?? null,
    lastTourNumber: lastTourRes.data?.[0]?.tour_number ?? null,
    polyvalentServices: qualifiedServices.length >= 2 ? qualifiedServices : null,
  });
}
