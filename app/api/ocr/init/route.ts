import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  // Absent pour un ticket de station : le plein n'est rattaché à aucune cuve.
  tank_id: z.string().uuid().optional(),
  occurred_at: z.string().datetime().optional(),
  // Set when scanning a driver badge on a shared device (a tablet
  // mounted at the pump rather than the chauffeur's own phone). RLS
  // still has the final say: a plain chauffeur passing someone
  // else's id here is rejected at the database level (see
  // "fuel_entries: chauffeur inserts own" in the RLS migration).
  driver_id: z.string().uuid().optional(),
});

/**
 * Step 2 of the OCR flow (Module 3): create the placeholder
 * fuel_entries row (status pending_ocr) the photo will attach to.
 * Keeps the row creation atomic and RLS-checked before any Storage
 * upload happens against it.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const ocrEnabled = await isModuleEnabled(supabase, appUser.organization_id, "ocr");
  if (!ocrEnabled) {
    return NextResponse.json({ error: "Module OCR non activé pour votre organisation" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("fuel_entries")
    .insert({
      organization_id: appUser.organization_id,
      vehicle_id: parsed.data.vehicle_id,
      tank_id: parsed.data.tank_id ?? null,
      driver_id: parsed.data.driver_id ?? appUser.id,
      created_by: appUser.id,
      occurred_at: parsed.data.occurred_at ?? new Date().toISOString(),
      status: "pending_ocr",
    })
    .select("id, organization_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    fuelEntryId: data.id,
    storagePath: `${data.organization_id}/${data.id}/ticket.jpg`,
  });
}
