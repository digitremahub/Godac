import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  tour_number: z.string().min(1),
  start_km: z.coerce.number().min(0).optional(),
});

/**
 * Opens a tour the moment a driver scans their vehicle — the digital
 * equivalent of filling out the paper "feuille de départ tournée".
 * The service is inherited from the vehicle (not the driver's own
 * user_services), since a tour belongs to whichever service owns the
 * truck. Same up-front-storage-path pattern as tank-photos: the row
 * exists with its final photo path before the browser uploads the
 * actual file.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: existingOpen } = await supabase
    .from("planning_entries")
    .select("id")
    .eq("driver_id", appUser.id)
    .eq("status", "in_progress")
    .maybeSingle();
  if (existingOpen) {
    return NextResponse.json(
      { error: "Vous avez déjà une tournée en cours — terminez-la avant d'en démarrer une nouvelle." },
      { status: 409 },
    );
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, service_id, registration")
    .eq("id", parsed.data.vehicle_id)
    .single();
  if (vehicleError || !vehicle) {
    return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });
  }
  if (!vehicle.service_id) {
    return NextResponse.json(
      { error: `${vehicle.registration} n'est rattaché à aucun service — contactez un gestionnaire.` },
      { status: 422 },
    );
  }

  const storagePath = `${appUser.organization_id}/${vehicle.id}/${randomUUID()}.jpg`;

  const { data, error } = await supabase
    .from("planning_entries")
    .insert({
      organization_id: appUser.organization_id,
      service_id: vehicle.service_id,
      tour_number: parsed.data.tour_number,
      driver_id: appUser.id,
      vehicle_id: vehicle.id,
      start_at: new Date().toISOString(),
      status: "in_progress",
      start_km: parsed.data.start_km,
      start_photo_path: storagePath,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tourId: data.id, storagePath });
}
