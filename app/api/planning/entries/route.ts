import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  tour_number: z.string().min(1),
  start_at: z.string().datetime(),
});

/**
 * Manager-authored planning assignment ("planned" — distinct from the
 * driver's own /api/tours, which inserts "in_progress" directly when
 * they scan a truck). RLS (planning_entries: manager-like writes
 * scoped to service) already rejects a manager assigning outside
 * their own service, so a bad service_id here surfaces as a plain DB
 * error rather than something this route needs to pre-check.
 * Inserting/updating a 'planned' row also fires the
 * after_planning_entry_upsert trigger, which notifies the driver.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (!["direction", "manager", "manager_chauffeur"].includes(appUser.role)) {
    return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d’équipe peut attribuer une tournée." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("planning_entries")
    .insert({
      organization_id: appUser.organization_id,
      service_id: parsed.data.service_id,
      tour_number: parsed.data.tour_number,
      driver_id: parsed.data.driver_id,
      vehicle_id: parsed.data.vehicle_id,
      start_at: parsed.data.start_at,
      status: "planned",
    })
    .select("id, organization_id, service_id, driver_id, vehicle_id, tour_number, start_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Une affectation existe déjà pour ce service, ce numéro de tournée et cette date/heure." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }


  const warning = await warnIfDriverDoubleBooked(supabase, {
    organizationId: appUser.organization_id,
    driverId: parsed.data.driver_id,
    startAt: parsed.data.start_at,
    excludeEntryId: data.id,
  });

  return NextResponse.json({ id: data.id, warning });
}
