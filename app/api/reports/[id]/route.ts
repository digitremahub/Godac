import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  report_bl_number: z.string().nullable().optional(),
  report_stops_total: z.number().int().min(0).nullable().optional(),
  report_packages_count: z.number().int().min(0).nullable().optional(),
  report_priority_count: z.number().int().min(0).nullable().optional(),
  report_stops_delivered: z.number().int().min(0).nullable().optional(),
  report_packages_missing: z.number().int().min(0).nullable().optional(),
  report_pickups: z.number().int().min(0).nullable().optional(),
  report_packages_picked_up: z.number().int().min(0).nullable().optional(),
  report_packages_returned: z.number().int().min(0).nullable().optional(),
  report_packages_relay: z.number().int().min(0).nullable().optional(),
  // Correction d'un km de départ/retour erroné (ex: valeur de test
  // saisie par erreur) — contourne volontairement
  // checkOdometerNotRegressing (lib/business/odometer.ts), qui ne
  // s'applique qu'au flux chauffeur de départ/fin de tournée ; ici
  // direction corrige un historique déjà figé, pas un nouveau relevé.
  start_km: z.number().min(0).nullable().optional(),
  end_km: z.number().min(0).nullable().optional(),
});

/**
 * Lets direction fill in whatever the OCR pass (lib/ocr/tour-report.ts)
 * missed or misread — /reports only ever displayed report_* fields
 * read-only until now, with no way to correct a "—" without re-taking
 * the photo. Scoped to direction only (not manager-like) since this
 * edits numbers that feed TICPE export and fuel-profitability
 * reporting elsewhere; RLS ("planning: manager-like writes scoped to
 * service") already lets direction write any planning_entries row, so
 * the role check here is the only gate needed.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  if (parsed.data.start_km !== undefined || parsed.data.end_km !== undefined) {
    const { data: current, error: currentError } = await supabase
      .from("planning_entries")
      .select("start_km, end_km")
      .eq("id", id)
      .single();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });

    const effectiveStart = parsed.data.start_km !== undefined ? parsed.data.start_km : current.start_km !== null ? Number(current.start_km) : null;
    const effectiveEnd = parsed.data.end_km !== undefined ? parsed.data.end_km : current.end_km !== null ? Number(current.end_km) : null;
    if (effectiveStart !== null && effectiveEnd !== null && effectiveEnd < effectiveStart) {
      return NextResponse.json({ error: "Le km de retour ne peut pas être inférieur au km de départ." }, { status: 422 });
    }
  }

  const { error } = await supabase.from("planning_entries").update(parsed.data).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
