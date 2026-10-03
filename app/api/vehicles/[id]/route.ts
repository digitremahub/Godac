import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const specSourceEntrySchema = z.object({ origin: z.enum(["ia", "saisie", "import"]), confirmed: z.boolean() });

const bodySchema = z.object({
  registration: z.string().min(1).optional(),
  type: z.enum(["VL", "PL", "SPL"]).optional(),
  tank_capacity_liters: z.coerce.number().positive().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "maintenance", "out_of_service"]).optional(),
  initial_km: z.coerce.number().min(0).nullable().optional(),
  assigned_driver_id: z.string().uuid().nullable().optional(),
  brand: z.string().min(1).nullable().optional(),
  model: z.string().min(1).nullable().optional(),
  model_year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().optional(),
  gearbox: z.string().nullable().optional(),
  fuel_type: z.string().nullable().optional(),
  adblue_capacity_liters: z.coerce.number().positive().nullable().optional(),
  ptac_kg: z.coerce.number().positive().nullable().optional(),
  reference_consumption_l_100km: z.coerce.number().positive().nullable().optional(),
  spec_sources: z.record(z.string(), specSourceEntrySchema).optional(),
});

/** Minimal lookup for flows that only have a vehicle_id (QR scan, tour start/end) and need its label. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, registration, type, status")
    .eq("id", id)
    .single();
  if (error || !data) return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });
  return NextResponse.json({ vehicle: data });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vehicles")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vehicle: data });
}
