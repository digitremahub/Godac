import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentTankPmp } from "@/lib/fuel/current-pmp";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  tank_id: z.string().uuid(),
  driver_id: z.string().uuid().optional(), // manager filling in on behalf of a driver
  occurred_at: z.string().datetime(),
  totalizer_before: z.coerce.number().nullable().optional(),
  totalizer_after: z.coerce.number(),
  totalizer_before_photo_path: z.string().optional(),
  totalizer_after_photo_path: z.string().optional(),
  vehicle_km: z.coerce.number().nonnegative().optional(),
  vehicle_km_photo_path: z.string().optional(),
  // Both optional: a cuve fill-up has neither on hand (see below), a
  // station purchase typed by hand still has both (no ticket photo,
  // but a real receipt in the driver's other hand).
  liters: z.coerce.number().positive().optional(),
  unit_price: z.coerce.number().nonnegative().optional(),
  station_name: z.string().optional(),
});

/**
 * Module 2: 100% manual fuel entry — the degraded mode when OCR is
 * off, or the driver picks "Plein cuve (totaliseur)" outright. The dominant
 * real case here is a fill-up from the company's own cuve: the driver
 * has no ticket and no idea what the fuel costs, only the totalizer
 * before/after and which vehicle. So when litres/prix aren't given:
 * - litres = totalizer_after - totalizer_before (the counter is the
 *   authoritative volume, never re-typed by hand).
 * - unit_price = the tank's current weighted-average cost
 *   (lib/fuel/current-pmp.ts) — never asked of the driver.
 * A station purchase typed by hand (real ticket in hand, no photo
 * taken) still passes both explicitly and keeps them as given.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  let liters = parsed.data.liters;
  if (liters === undefined) {
    if (parsed.data.totalizer_before === null || parsed.data.totalizer_before === undefined) {
      return NextResponse.json(
        { error: "Indiquez le litrage ou l'index du compteur avant le plein pour le déduire." },
        { status: 422 },
      );
    }
    liters = Math.round((parsed.data.totalizer_after - parsed.data.totalizer_before) * 100) / 100;
    if (liters <= 0) {
      return NextResponse.json({ error: "L'index après le plein doit être supérieur à l'index avant." }, { status: 422 });
    }
  }

  let unitPrice = parsed.data.unit_price;
  if (unitPrice === undefined) {
    const currentPmp = await getCurrentTankPmp(supabase, parsed.data.tank_id);
    if (currentPmp === null) {
      return NextResponse.json(
        { error: "Aucun historique de prix pour cette cuve — enregistrez d'abord un approvisionnement, ou indiquez le prix au litre." },
        { status: 422 },
      );
    }
    unitPrice = currentPmp;
  }

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
      vehicle_km: parsed.data.vehicle_km ?? null,
      vehicle_km_photo_path: parsed.data.vehicle_km_photo_path,
      liters,
      unit_price: unitPrice,
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
