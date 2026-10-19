import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  totalizer_before: z.coerce.number().nonnegative().nullable().optional(),
  totalizer_after: z.coerce.number().positive().nullable().optional(),
  totalizer_before_photo_path: z.string().optional(),
  totalizer_after_photo_path: z.string().optional(),
  vehicle_km: z.coerce.number().nonnegative().optional(),
  vehicle_km_photo_path: z.string().optional(),
  liters: z.coerce.number().positive().max(5000).optional(),
  unit_price: z.coerce.number().positive().max(10).optional(),
  product: z.enum(["gazole", "adblue"]).optional(),
  occurred_at: z.string().datetime().optional(),
  station_name: z.string().nullable().optional(),
  vehicle_id: z.string().uuid().optional(),
  // null : achat en station (aucune cuve).
  tank_id: z.string().uuid().nullable().optional(),
  /** Set by the OCR review UI (Module 3) once a manager confirms the extracted/corrected fields. */
  validate: z.boolean().optional(),
  /** Set when an ocr_failed row is completed by hand — the degraded-mode fallback never silently drops the ticket photo already attached. */
  markManual: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
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
 * real gate on who can touch which row (migration 122 : le chauffeur
 * complète et valide son ticket en attente, la modification d'un plein
 * enregistré revient au manager / à la direction) ; the triggers of
 * migration 121 report any change of litres or tank onto the tank stock.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g2 = await garderApi({ roles: "tous" });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { validate, markManual, ...fields } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const { data: current } = await supabase.from("fuel_entries").select("status, tank_id").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Plein introuvable." }, { status: 404 });
  const dejaEnregistre = current.status === "manual" || current.status === "validated";
  // Revalider un plein déjà enregistré ne doit rien rejouer (stock, alertes).
  if (dejaEnregistre && (validate || markManual)) {
    return NextResponse.json({ error: "Ce plein est déjà enregistré." }, { status: 409 });
  }
  if (fields.occurred_at && new Date(fields.occurred_at).getTime() > Date.now() + 10 * 60_000) {
    return NextResponse.json({ error: "La date du plein est dans le futur." }, { status: 422 });
  }
  const tankFinal = fields.tank_id !== undefined ? fields.tank_id : current.tank_id;
  if (tankFinal === null) {
    // Achat en station : ni totaliseur, ni produit déduit d'une cuve.
    fields.totalizer_before = null;
    fields.totalizer_after = null;
  } else if (fields.product !== undefined) {
    // Plein cuve : le produit est celui de la cuve (fixé par la base).
    delete fields.product;
  }

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

  if (dejaEnregistre) {
    await journaliser({
      organizationId: appUser.organization_id,
      userId: appUser.id,
      action: "plein_modification",
      targetTable: "fuel_entries",
      targetId: id,
      details: fields,
    });
  }
  return NextResponse.json({ fuelEntry: data });
}
