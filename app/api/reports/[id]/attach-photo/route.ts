import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { arretsLivraison, type LectureArrets } from "@/lib/ocr/arrets";

const startFieldsSchema = z.object({
  bl_number: z.string().nullable(),
  stops_total: z.number().int().nonnegative().nullable(),
  stops_scan: z.number().int().nonnegative().nullable().optional(),
  pickups: z.number().int().nonnegative().nullable(),
  packages_count: z.number().int().nonnegative().nullable(),
  priority_count: z.number().int().nonnegative().nullable(),
  departure_time: z.string().nullable(),
});

const endFieldsSchema = z.object({
  bl_number: z.string().nullable(),
  stops_total: z.number().int().nonnegative().nullable(),
  stops_scan: z.number().int().nonnegative().nullable().optional(),
  stops_delivered: z.number().int().nonnegative().nullable(),
  packages_missing: z.number().int().nonnegative().nullable(),
  pickups: z.number().int().nonnegative().nullable(),
  return_time: z.string().nullable(),
  packages_picked_up: z.number().int().nonnegative().nullable(),
  packages_returned: z.number().int().nonnegative().nullable(),
  packages_relay: z.number().int().nonnegative().nullable(),
});

const bodySchema = z.union([
  z.object({ stage: z.literal("start"), photo_path: z.string().min(1), fields: startFieldsSchema.partial() }),
  // Feuille de début de tournée (photo ou PDF), distincte de l'écran du terminal.
  z.object({ stage: z.literal("start_sheet"), photo_path: z.string().min(1), fields: startFieldsSchema.partial() }),
  z.object({ stage: z.literal("end"), photo_path: z.string().min(1), fields: endFieldsSchema.partial() }),
]);

/**
 * Recovery path for a tour closed without its departure/retour report
 * photo ever saving — e.g. a network failure mid-upload (see
 * TourReportPhotoCapture) that a driver didn't notice because the
 * photo was never required to close the tour (EndTourFlow/
 * StartTourFlow's canSubmit don't check for it). Lets direction
 * attach the photo after the fact — the driver re-photographs the
 * same paper report — and replays the same OCR→column mapping
 * app/api/tours/route.ts and app/api/tours/[id]/route.ts use live.
 * Only fills columns still null: never overwrites a value direction
 * may already have corrected by hand via ReportsTable's inline edit.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: ["direction", "manager", "exploitation"], modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.photo_path.startsWith(`${appUser.organization_id}/`)) {
    return NextResponse.json({ error: "Chemin de photo invalide." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: tour, error: fetchError } = await supabase
    .from("planning_entries")
    .select(
      "start_photo_path, start_sheet_path, end_photo_path, report_ocr_raw, report_bl_number, report_stops_total, report_packages_count, report_priority_count, report_departure_time, report_stops_delivered, report_packages_missing, report_pickups, report_return_time, report_packages_picked_up, report_packages_returned, report_packages_relay",
    )
    .eq("id", id)
    .single();
  if (fetchError || !tour) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  const colonne = parsed.data.stage === "start" ? "start_photo_path" : parsed.data.stage === "start_sheet" ? "start_sheet_path" : "end_photo_path";
  const alreadyHasPhoto = Boolean((tour as Record<string, unknown>)[colonne]);
  if (alreadyHasPhoto) {
    return NextResponse.json({ error: "Une photo est déjà enregistrée pour cette étape." }, { status: 409 });
  }

  let candidates: Record<string, string | number | null | undefined>;
  if (parsed.data.stage === "start" || parsed.data.stage === "start_sheet") {
    const f = parsed.data.fields;
    candidates = {
      report_bl_number: f.bl_number,
      report_pickups: f.pickups,
      report_packages_count: f.packages_count,
      report_priority_count: f.priority_count,
      report_departure_time: f.departure_time,
    };
  } else {
    const f = parsed.data.fields;
    candidates = {
      report_bl_number: f.bl_number,
      report_stops_delivered: f.stops_delivered,
      report_packages_missing: f.packages_missing,
      report_pickups: f.pickups,
      report_return_time: f.return_time,
      report_packages_picked_up: f.packages_picked_up,
      report_packages_returned: f.packages_returned,
      report_packages_relay: f.packages_relay,
    };
  }

  const tourColumns = tour as Record<string, unknown>;
  const update: Record<string, unknown> = {
    [colonne]: parsed.data.photo_path,
    report_ocr_raw: { ...((tour.report_ocr_raw as object) ?? {}), [parsed.data.stage]: parsed.data.fields },
  };
  for (const [column, value] of Object.entries(candidates)) {
    if (value !== undefined && value !== null && tourColumns[column] === null) {
      update[column] = value;
    }
  }
  // Arrêts de livraison = stops du scan − ramasses, recalculés avec tout
  // ce qui est connu (départ + retour), voir lib/ocr/arrets.ts.
  const lectures = update.report_ocr_raw as { start?: LectureArrets; start_sheet?: LectureArrets; end?: LectureArrets };
  const depart = lectures.start?.stops_total != null ? lectures.start : lectures.start_sheet;
  const arrets = arretsLivraison(depart, lectures.end);
  if (arrets !== null) update.report_stops_total = arrets;

  const { error } = await supabase.from("planning_entries").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
