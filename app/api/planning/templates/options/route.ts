import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const user = await requireAppUser();
  if (!["direction", "manager", "manager_chauffeur"].includes(user.role)) {
    return NextResponse.json({ error: "Accès réservé aux responsables." }, { status: 403 });
  }
  const serviceId = new URL(req.url).searchParams.get("service_id");
  if (!serviceId) return NextResponse.json({ error: "Service requis." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  const [{ data: routes, error: routeError }, { data: drivers, error: driverError }, { data: vehicles, error: vehicleError }] = await Promise.all([
    supabase.from("tour_routes").select("id, tour_number, default_driver_id").eq("organization_id", user.organization_id).eq("service_id", serviceId).order("tour_number"),
    supabase.from("users").select("id, full_name").eq("organization_id", user.organization_id).eq("active", true).in("role", ["chauffeur", "manager_chauffeur"]).order("full_name"),
    supabase.from("vehicles").select("id, registration, service_id").eq("organization_id", user.organization_id).order("registration"),
  ]);
  if (routeError || driverError || vehicleError) return NextResponse.json({ error: "Impossible de charger les tournées, chauffeurs et véhicules." }, { status: 500 });
  return NextResponse.json({ routes: routes ?? [], drivers: drivers ?? [], vehicles: (vehicles ?? []).filter(v => !v.service_id || v.service_id === serviceId) });
}
