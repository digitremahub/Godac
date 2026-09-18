import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  tank_id: z.string().uuid(),
  driver_id: z.string().uuid().optional(), // manager filling in on behalf of a driver
  occurred_at: z.string().datetime(),
  totalizer_before: z.coerce.number().nullable().optional(),
  totalizer_after: z.coerce.number(),
  totalizer_before_photo_path: z.string().optional(),
  totalizer_after_photo_path: z.string().optional(),
  liters: z.coerce.number().positive(),
  unit_price: z.coerce.number().nonnegative(),
  station_name: z.string().optional(),
});

/** Module 2: 100% manual fuel entry — the degraded mode when OCR is off or unwanted. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fuel_entries")
    .insert({
      organization_id: appUser.organization_id,
      vehicle_id: parsed.data.vehicle_id,
      tank_id: parsed.data.tank_id,
      driver_id: parsed.data.driver_id ?? appUser.id,
      created_by: appUser.id,
      occurred_at: parsed.data.occurred_at,
      totalizer_before: parsed.data.totalizer_before ?? null,
      totalizer_after: parsed.data.totalizer_after,
      totalizer_before_photo_path: parsed.data.totalizer_before_photo_path,
      totalizer_after_photo_path: parsed.data.totalizer_after_photo_path,
      liters: parsed.data.liters,
      unit_price: parsed.data.unit_price,
      station_name: parsed.data.station_name,
      status: "manual",
    })
    .select("id, gap_flagged, totalizer_gap, pmp_at_entry")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ fuelEntry: data });
}
