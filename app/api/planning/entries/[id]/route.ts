import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAppUser } from "@/lib/auth/session";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";

const patchSchema = z.object({
  start_at: z.string().datetime().optional(),
  service_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  vehicle_id: z.string().uuid().optional(),
  tour_number: z.string().min(1).optional(),
});

/**
 * Reschedule/reassign a still-"planned" entry — this is what the
 * planning grid's drag-to-move and edit actions call. Scoped to
 * status='planned' so a manager can't retroactively edit a tour the
 * driver has already started or finished from here.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("planning_entries")
    .update(parsed.data)
    .eq("id", id)
    .eq("status", "planned")
    .select("id, organization_id, service_id, driver_id, vehicle_id, tour_number, start_at")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Une affectation existe déjà pour ce service, ce numéro de tournée et cette date/heure." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Affectation introuvable ou déjà démarrée." }, { status: 404 });


  const warning = data.driver_id
    ? await warnIfDriverDoubleBooked(supabase, {
        organizationId: appUser.organization_id,
        driverId: data.driver_id,
        startAt: data.start_at,
        excludeEntryId: data.id,
      })
    : null;

  return NextResponse.json({ id: data.id, warning });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("planning_entries")
    .delete()
    .eq("id", id)
    .eq("status", "planned")
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Affectation introuvable ou déjà démarrée." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
