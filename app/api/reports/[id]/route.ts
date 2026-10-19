import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { journaliser } from "@/lib/audit/journal";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { arretsLivraison, type LectureArrets } from "@/lib/ocr/arrets";

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
  report_departure_time: z.string().nullable().optional(),
  report_return_time: z.string().nullable().optional(),
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
  const g = await garderApi({ roles: ["direction", "manager", "manager_chauffeur"], modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
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

  // Ramasses corrigées sans toucher aux arrêts : recalcule les arrêts de
  // livraison depuis le total du scan (stops du scan − ramasses).
  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.report_pickups !== undefined) {
    const { data: actuel } = await supabase
      .from("planning_entries")
      .select("report_pickups, report_stops_total, report_ocr_raw")
      .eq("id", id)
      .single();
    const arretsInchanges = parsed.data.report_stops_total === undefined || parsed.data.report_stops_total === actuel?.report_stops_total;
    if (actuel && arretsInchanges && parsed.data.report_pickups !== actuel.report_pickups) {
      const lectures = (actuel.report_ocr_raw as { start?: LectureArrets; start_sheet?: LectureArrets; end?: LectureArrets } | null) ?? {};
      const brut = lectures.end?.stops_scan ?? lectures.start?.stops_scan ?? lectures.start_sheet?.stops_scan ?? null;
      if (brut != null) update.report_stops_total = arretsLivraison({ stops_scan: brut }, { pickups: parsed.data.report_pickups });
    }
  }

  const { error } = await supabase.from("planning_entries").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await journaliser({
    organizationId: appUser.organization_id,
    userId: appUser.id,
    action: "rapport_correction",
    targetTable: "planning_entries",
    targetId: id,
    details: parsed.data,
  });
  return NextResponse.json({ ok: true });
}
