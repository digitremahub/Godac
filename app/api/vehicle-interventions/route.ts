import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const CATEGORY_LABELS: Record<string, string> = {
  mechanical: "Problème mécanique",
  bodywork: "Carrosserie",
  tires: "Pneumatiques",
  maintenance: "Entretien / révision",
  other: "Autre",
};

const bodySchema = z
  .object({
    vehicle_id: z.string().uuid(),
    // `type` stays accepted as free text for callers that don't use
    // the fixed list yet (InterventionsPanel's manager quick-add);
    // the driver-facing form sends `category` instead.
    type: z.string().min(1).optional(),
    category: z.enum(["mechanical", "bodywork", "tires", "maintenance", "other"]).optional(),
    description: z.string().optional(),
    urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    scheduled_at: z.string().datetime().optional(),
    cost: z.coerce.number().nonnegative().optional(),
    odometer_km: z.coerce.number().min(0).optional(),
    odometer_photo_path: z.string().optional(),
    appointment_needed: z.boolean().optional().default(false),
    photo_count: z.coerce.number().int().min(0).max(4).optional().default(0),
  })
  .superRefine((data, ctx) => {
    if (!data.type && !data.category) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le type est obligatoire.", path: ["type"] });
    }
  });

/**
 * "Demandes d'Entretien" (module maintenance_requests): any org
 * member can open a request naming themselves as requester — RLS
 * ("interventions: any member requests") is the real gate, allowing
 * this alongside manager-like's full write access. Photo storage
 * paths are generated here, before the browser uploads anything —
 * same up-front-path pattern as tour-photos/tank-photos.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { category, photo_count, type, ...rest } = parsed.data;

  const supabase = await createServerSupabaseClient();

  const photoPaths = Array.from(
    { length: photo_count },
    () => `${appUser.organization_id}/${parsed.data.vehicle_id}/${randomUUID()}.jpg`,
  );

  const { data, error } = await supabase
    .from("vehicle_interventions")
    .insert({
      organization_id: appUser.organization_id,
      requested_by: appUser.id,
      type: type ?? CATEGORY_LABELS[category!],
      category: category ?? null,
      photo_paths: photoPaths,
      ...rest,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ intervention: data, photoPaths });
}
