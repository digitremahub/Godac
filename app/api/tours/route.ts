import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  tour_number: z.string().min(1),
  start_km: z.coerce.number().min(0).optional(),
  start_km_photo_path: z.string().optional(),
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
  const startFields = {
    vehicle_id: vehicle.id,
    service_id: vehicle.service_id,
    start_at: new Date().toISOString(),
    status: "in_progress" as const,
    start_km: parsed.data.start_km,
    start_km_photo_path: parsed.data.start_km_photo_path,
    start_photo_path: storagePath,
  };

  // If a manager already planned this exact tour number for this
  // driver (the /planning grid), turn that same row into the real
  // one instead of creating a parallel record — this is what keeps
  // a last-minute vehicle swap or delay reflected on the manager's
  // planning rather than leaving a stale "planned" entry sitting next
  // to a disconnected "in_progress" one.
  const { data: plannedMatch } = await supabase
    .from("planning_entries")
    .select("id")
    .eq("driver_id", appUser.id)
    .eq("tour_number", parsed.data.tour_number)
    .eq("status", "planned")
    .maybeSingle();

  const { data, error } = plannedMatch
    ? await supabase.from("planning_entries").update(startFields).eq("id", plannedMatch.id).select("id").single()
    : await supabase
        .from("planning_entries")
        .insert({ organization_id: appUser.organization_id, tour_number: parsed.data.tour_number, driver_id: appUser.id, ...startFields })
        .select("id")
        .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tourId: data.id, storagePath });
}
