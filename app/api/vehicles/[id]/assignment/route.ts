import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  claim: z.boolean(),
});

/**
 * "Mon véhicule" self-service: a chauffeur takes an unassigned
 * vehicle, or releases the one they already hold. Separate from the
 * manager edit path (PATCH /api/vehicles/[id], gated by the
 * "vehicles: manager-like write scoped to service" RLS policy) since
 * this is a narrower, conditional write RLS can't express as a
 * blanket grant without also handing chauffeur every other column —
 * the condition is checked here in app code, then written with the
 * service-role client, same trust model as lib/auth/driver-pin.ts.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!hasRole(appUser.role, ["chauffeur", "manager_chauffeur"])) {
    return NextResponse.json({ error: "Seuls les chauffeurs peuvent prendre ou libérer un véhicule." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, assigned_driver_id")
    .eq("id", id)
    .single();
  if (vehicleError || !vehicle) {
    return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });
  }

  if (parsed.data.claim) {
    if (vehicle.assigned_driver_id && vehicle.assigned_driver_id !== appUser.id) {
      return NextResponse.json({ error: "Ce véhicule est déjà pris par un autre chauffeur." }, { status: 409 });
    }
  } else if (vehicle.assigned_driver_id !== appUser.id) {
    return NextResponse.json({ error: "Ce véhicule ne vous est pas assigné." }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("vehicles")
    .update({ assigned_driver_id: parsed.data.claim ? appUser.id : null })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
