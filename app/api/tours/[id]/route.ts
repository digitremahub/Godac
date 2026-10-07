import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkOdometerNotRegressing } from "@/lib/business/odometer";
import { reportVehicleSwap } from "@/lib/planning/vehicle-swap-alert";

const reportFieldsSchema = z.object({
  bl_number: z.string().nullable(),
  stops_delivered: z.number().int().nonnegative().nullable(),
  packages_missing: z.number().int().nonnegative().nullable(),
  pickups: z.number().int().nonnegative().nullable(),
  return_time: z.string().nullable(),
  packages_picked_up: z.number().int().nonnegative().nullable(),
  packages_returned: z.number().int().nonnegative().nullable(),
  packages_relay: z.number().int().nonnegative().nullable(),
});

const bodySchema = z
  .object({
    vehicle_id: z.string().uuid(),
    end_km: z.coerce.number().min(0),
    end_km_photo_path: z.string().optional(),
    // Already uploaded via TourReportPhotoCapture, see app/api/tours/route.ts's POST for the same change on the departure side.
    sheet_photo_path: z.string().optional(),
    report_fields: reportFieldsSchema.partial().optional(),
    notes: z.string().optional(),
    return_type: z.enum(["depot", "domicile"]).optional(),
    vehicle_ok: z.boolean(),
    problem_description: z.string().min(1).optional(),
    // Required only when vehicle_id differs from the vehicle scanned
    // at departure (checked server-side below, e.g. a breakdown
    // swap mid-tour) — never just trusted from a client-side flag.
    change_reason: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.vehicle_ok && !data.problem_description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La description du problème est obligatoire.",
        path: ["problem_description"],
      });
    }
  });

/**
 * Closes out a tour — the digital "rapport retour". vehicle_id
 * normally matches the one scanned at departure (auto-selected
 * client-side, no re-scan needed); a mismatch is only accepted with
 * an explicit change_reason (mid-tour breakdown/swap), checked
 * server-side, never just trusted from a client-side flag.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: tour, error: tourError } = await supabase
    .from("planning_entries")
    .select("id, vehicle_id, driver_id, status, tour_number, start_km, report_ocr_raw")
    .eq("id", id)
    .single();
  if (tourError || !tour) {
    return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });
  }
  if (tour.driver_id !== appUser.id || tour.status !== "in_progress") {
    return NextResponse.json({ error: "Cette tournée n'est pas ouverte pour vous." }, { status: 403 });
  }

  const vehicleChanged = tour.vehicle_id !== parsed.data.vehicle_id;
  if (vehicleChanged && !parsed.data.change_reason) {
    return NextResponse.json(
      { error: "Un motif est requis : ce véhicule n'est pas celui utilisé au départ de cette tournée." },
      { status: 422 },
    );
  }
  if (vehicleChanged) {
    const { data: newVehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("id")
      .eq("id", parsed.data.vehicle_id)
      .single();
    if (vehicleError || !newVehicle) {
      return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });
    }
  }

  // "retour < départ" is rejected outright; a very large gap is
  // accepted but flagged for a manager (see the
  // planning_entries_after_odometer_check trigger that fires on this
  // same update, mirroring lib/business/odometer.ts's checkTourDistanceGap).
  const regressionCheck = checkOdometerNotRegressing(
    parsed.data.end_km,
    tour.start_km !== null ? Number(tour.start_km) : null,
    "le kilométrage de départ de cette tournée",
  );
  if (!regressionCheck.ok) {
    return NextResponse.json({ error: regressionCheck.message }, { status: 422 });
  }

  const reportFields = parsed.data.report_fields;

  const { error } = await supabase
    .from("planning_entries")
    .update({
      vehicle_id: parsed.data.vehicle_id,
      end_at: new Date().toISOString(),
      end_km: parsed.data.end_km,
      end_km_photo_path: parsed.data.end_km_photo_path,
      notes: parsed.data.notes || null,
      end_photo_path: parsed.data.sheet_photo_path ?? null,
      end_vehicle_ok: parsed.data.vehicle_ok,
      return_type: parsed.data.return_type ?? null,
      status: "done",
      ...(reportFields
        ? {
            report_bl_number: reportFields.bl_number ?? undefined,
            report_stops_delivered: reportFields.stops_delivered ?? null,
            report_packages_missing: reportFields.packages_missing ?? null,
            report_pickups: reportFields.pickups ?? null,
            report_return_time: reportFields.return_time ?? null,
            report_packages_picked_up: reportFields.packages_picked_up ?? null,
            report_packages_returned: reportFields.packages_returned ?? null,
            report_packages_relay: reportFields.packages_relay ?? null,
            report_ocr_raw: { ...((tour.report_ocr_raw as object) ?? {}), end: reportFields },
          }
        : {}),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (vehicleChanged && parsed.data.change_reason) {
    await reportVehicleSwap(supabase, {
      organizationId: appUser.organization_id,
      plannedEntryId: tour.id,
      plannedVehicleId: tour.vehicle_id,
      actualVehicleId: parsed.data.vehicle_id,
      reason: parsed.data.change_reason,
      stage: "retour",
    });
  }

  let problemPhotoStoragePath: string | null = null;
  if (!parsed.data.vehicle_ok) {
    problemPhotoStoragePath = `${appUser.organization_id}/${parsed.data.vehicle_id}/${randomUUID()}.jpg`;
    const { error: interventionError } = await supabase.from("vehicle_interventions").insert({
      organization_id: appUser.organization_id,
      vehicle_id: parsed.data.vehicle_id,
      type: "Signalement automatique (retour de tournée)",
      description: parsed.data.problem_description,
      urgency: "normal",
      requested_by: appUser.id,
      planning_entry_id: tour.id,
      photo_path: problemPhotoStoragePath,
    });
    if (interventionError) return NextResponse.json({ error: interventionError.message }, { status: 500 });
  }

  return NextResponse.json({ problemPhotoStoragePath });
}
