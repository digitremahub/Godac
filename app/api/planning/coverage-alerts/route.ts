import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Planning coverage audit for managers. Reports planned tours without a
 * driver and approved leave overlapping an assigned driver's workday.
 * Template coverage is based on active planning_tour_templates.
 */
export async function GET(req: Request) {
  const user = await requireAppUser();
  if (!["direction", "manager", "manager_chauffeur"].includes(user.role)) {
    return NextResponse.json({ error: "Accès réservé aux responsables du planning." }, { status: 403 });
  }

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
    return NextResponse.json({ error: "Période invalide." }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const [{ data: entries, error: entriesError }, { data: leaves, error: leavesError }] = await Promise.all([
    supabase.from("planning_entries")
      .select("id, service_id, tour_number, driver_id, start_at")
      .eq("organization_id", user.organization_id)
      .gte("start_at", start + "T00:00:00")
      .lt("start_at", end + "T00:00:00")
      .neq("status", "done"),
    supabase.from("leave_requests")
      .select("id, driver_id, service_id, start_date, end_date, status")
      .eq("organization_id", user.organization_id)
      .eq("status", "approved")
      .lte("start_date", end)
      .gte("end_date", start),
  ]);
  if (entriesError || leavesError) {
    return NextResponse.json({ error: "Impossible de vérifier les affectations et congés." }, { status: 500 });
  }

  const serviceIds = Array.from(new Set((entries ?? []).map((e) => e.service_id)));
  const [{ data: services }, { data: routes }] = await Promise.all([
    supabase.from("services").select("id, name").in("id", serviceIds.length ? serviceIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase.from("tour_routes").select("tour_number, service_id, default_driver_id").eq("organization_id", user.organization_id),
  ]);
  const serviceName = new Map((services ?? []).map((s) => [s.id, s.name]));
  const alerts: Array<{ type: string; severity: string; date: string; service: string; tour_number: string; message: string; entry_id: string }> = [];

  for (const entry of entries ?? []) {
    const date = entry.start_at.slice(0, 10);
    const service = serviceName.get(entry.service_id) ?? "Service";
    if (!entry.driver_id) {
      alerts.push({ type: "missing_driver", severity: "error", date, service, tour_number: entry.tour_number, message: "Aucun chauffeur attribué.", entry_id: entry.id });
      continue;
    }
    const leave = (leaves ?? []).find((l) => l.driver_id === entry.driver_id && l.service_id === entry.service_id && l.start_date <= date && l.end_date >= date);
    if (leave) alerts.push({ type: "driver_on_leave", severity: "error", date, service, tour_number: entry.tour_number, message: "Le chauffeur affecté est en congé approuvé.", entry_id: entry.id });
  }

  const routeKeys = new Set((entries ?? []).map((e) => e.service_id + ":" + e.tour_number + ":" + e.start_at.slice(0, 10)));
  const activeTemplates = await supabase.from("planning_tour_templates")
    .select("service_id, route_id, name, weekdays, departure_time, active, tour_routes(tour_number, default_driver_id)")
    .eq("organization_id", user.organization_id).eq("active", true);
  if (activeTemplates.error) {
    return NextResponse.json({ error: "Impossible de vérifier les modèles actifs. Vérifiez les migrations de modèles de planning." }, { status: 500 });
  }
  for (const template of activeTemplates.data ?? []) {
    const route = Array.isArray(template.tour_routes) ? template.tour_routes[0] : template.tour_routes;
    if (!route?.tour_number) continue;
    for (let cursor = new Date(start + "T12:00:00Z"); cursor < new Date(end + "T12:00:00Z"); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      const weekday = (cursor.getUTCDay() + 6) % 7;
      if (!(template.weekdays ?? []).includes(weekday)) continue;
      if (routeKeys.has(template.service_id + ":" + route.tour_number + ":" + date)) continue;
      alerts.push({ type: "missing_tour", severity: "warning", date, service: serviceName.get(template.service_id) ?? "Service", tour_number: route.tour_number, message: "Tournée habituelle non planifiée.", entry_id: "" });
    }
  }
  return NextResponse.json({ alerts, count: alerts.length });
}
