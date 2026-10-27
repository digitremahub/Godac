import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getVehicleLatestKmReading } from "@/lib/vehicles/odometer-reference";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dernier kilométrage connu d'un véhicule de l'organisation, affiché à l'étape
 * du kilométrage de l'assistant de plein (« dernier relevé : 125 430 km le
 * 12/10 »). Tout membre : c'est l'information qu'il a sous les yeux au
 * compteur. Le véhicule est vérifié dans l'organisation ; la lecture passe par
 * le client service parce que la RLS ne montre à un chauffeur que ses propres
 * tournées.
 */
export async function GET(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const vehicleId = new URL(req.url).searchParams.get("vehicle_id") ?? "";
  if (!UUID.test(vehicleId)) return NextResponse.json({ error: "Véhicule invalide." }, { status: 400 });
  const admin = createAdminSupabaseClient();
  const { data: vehicule } = await admin.from("vehicles").select("id").eq("id", vehicleId).eq("organization_id", g.appUser.organization_id).maybeSingle();
  if (!vehicule) return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });
  return NextResponse.json({ dernierKm: await getVehicleLatestKmReading(admin, vehicleId) });
}
