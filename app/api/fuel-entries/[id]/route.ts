import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  totalizer_before: z.coerce.number().nullable().optional(),
  totalizer_after: z.coerce.number().optional(),
  liters: z.coerce.number().positive().optional(),
  unit_price: z.coerce.number().nonnegative().optional(),
  occurred_at: z.string().datetime().optional(),
  station_name: z.string().nullable().optional(),
  vehicle_id: z.string().uuid().optional(),
  tank_id: z.string().uuid().optional(),
  /** Set by the OCR review UI (Module 3) once a manager confirms the extracted/corrected fields. */
  validate: z.boolean().optional(),
  /** Set when an ocr_failed row is completed by hand — the degraded-mode fallback never silently drops the ticket photo already attached. */
  markManual: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("fuel_entries")
    .select(
      "id, status, occurred_at, liters, unit_price, station_name, totalizer_before, totalizer_after, ocr_error, ocr_confidence, gap_flagged, totalizer_gap, pmp_at_entry, ticket_photo_path, vehicle_id, tank_id",
    )
    .eq("id", id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ fuelEntry: data });
}

/**
 * Edits a fuel entry, and/or promotes it to `validated`. RLS is the
 * real gate on who can touch which row (see
 * supabase/migrations/20260101000009_rls_policies.sql); this route
 * just shapes the payload and stamps validated_by/validated_at.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { validate, markManual, ...fields } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const update: Record<string, unknown> = { ...fields };
  if (validate) {
    update.status = "validated";
    update.validated_by = appUser.id;
    update.validated_at = new Date().toISOString();
  } else if (markManual) {
    update.status = "manual";
  }

  const { data, error } = await supabase
    .from("fuel_entries")
    .update(update)
    .eq("id", id)
    .select("id, status, gap_flagged, totalizer_gap, pmp_at_entry")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ fuelEntry: data });
}
