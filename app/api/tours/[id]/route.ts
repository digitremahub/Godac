import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  end_km: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});

/**
 * Closes out a tour the moment a driver scans their vehicle again at
 * day's end — the digital "rapport retour". vehicle_id is re-checked
 * server-side (not just trusted from the client's earlier /open
 * lookup) so a stray scan of the wrong truck can't close the wrong
 * tour.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: tour, error: tourError } = await supabase
    .from("planning_entries")
    .select("id, vehicle_id, driver_id, status")
    .eq("id", id)
    .single();
  if (tourError || !tour) {
    return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  }
  if (tour.driver_id !== appUser.id || tour.status !== "in_progress") {
    return NextResponse.json({ error: "Cette tournée n'est pas ouverte pour vous." }, { status: 403 });
  }
  if (tour.vehicle_id !== parsed.data.vehicle_id) {
    return NextResponse.json({ error: "Cette tournée concerne un autre véhicule." }, { status: 409 });
  }

  const storagePath = `${appUser.organization_id}/${tour.vehicle_id}/${randomUUID()}.jpg`;

  const { error } = await supabase
    .from("planning_entries")
    .update({
      end_at: new Date().toISOString(),
      end_km: parsed.data.end_km,
      notes: parsed.data.notes || null,
      end_photo_path: storagePath,
      status: "done",
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ storagePath });
}
