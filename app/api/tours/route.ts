import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { resolveTourActor } from "@/lib/tours/on-behalf";
import { checkOdometerNotRegressing } from "@/lib/business/odometer";
import { generateTourNumber } from "@/lib/business/tour-number";
import { getVehicleLastKnownKm } from "@/lib/vehicles/odometer-reference";
import { reportVehicleSwap } from "@/lib/planning/vehicle-swap-alert";
import { libellePhoto, photoChangementSchema, photosManquantes } from "@/lib/tours/changement-vehicule";
import { enregistrerPhotosChangement } from "@/lib/tours/photos-changement-serveur";
import { arretsLivraison } from "@/lib/ocr/arrets";
import { refusSiFermee } from "@/lib/planning/ouverture-serveur";

const reportFieldsSchema = z.object({
  tour_number: z.string().nullable(),
  bl_number: z.string().nullable(),
  stops_total: z.number().int().nonnegative().nullable(),
  stops_scan: z.number().int().nonnegative().nullable().optional(),
  pickups: z.number().int().nonnegative().nullable(),
  packages_count: z.number().int().nonnegative().nullable(),
  priority_count: z.number().int().nonnegative().nullable(),
  departure_time: z.string().nullable(),
});

const bodySchema = z
  .object({
    vehicle_id: z.string().uuid(),
    tour_number: z.string().min(1).optional(),
    // From GET /api/tours/open's plannedToday, round-tripped by
    // StartTourFlow — links this start directly to the row a manager
    // already planned, rather than the fragile tour_number text match
    // below (which still runs as a fallback for a driver who typed a
    // tour number without ever seeing a plannedToday suggestion).
    planned_entry_id: z.string().uuid().optional(),
    // Only meaningful for a polyvalent driver (StartTourFlow shows the
    // picker it comes from only then) — checked against their own
    // user_services below, never trusted as-is.
    service_id: z.string().uuid().optional(),
    start_km: z.coerce.number().min(0),
    start_km_photo_path: z.string().optional(),
    // Already uploaded via TourReportPhotoCapture (app/api/ocr/tour-report/init+process),
    // unlike the problem photo below which is still uploaded after this insert returns its id.
    sheet_photo_path: z.string().optional(),
    /** Feuille de début de tournée (photo ou PDF), en plus de l'écran du terminal. */
    start_sheet_path: z.string().optional(),
    report_fields: reportFieldsSchema.partial().optional(),
    vehicle_ok: z.boolean(),
    problem_description: z.string().min(1).optional(),
    // Required only when the submitted vehicle_id differs from the
    // planned entry's original vehicle — checked server-side below,
    // never just trusted from a client-side "vehicleChanged" flag.
    change_reason: z.string().min(1).optional(),
    // Changement (photos d'état obligatoires) ou dépannage (aucune photo exigée).
    change_type: z.enum(["changement", "depannage"]).optional(),
    change_photos: z.array(photoChangementSchema).max(12).optional(),
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
 * Opens a tour the moment a driver scans their vehicle — the digital
 * equivalent of filling out the paper "feuille de départ tournée".
 * The service normally just follows the scanned vehicle (a tour
 * belongs to whichever service owns the truck) — except for a
 * polyvalent driver (qualified on 2+ services), who can explicitly
 * pick which service they're working under today (StartTourFlow's
 * service picker), e.g. when sharing a vehicle across services. That
 * pick is still checked against their own user_services here, never
 * trusted as-is. Same up-front-storage-path pattern as tank-photos:
 * the row exists with its final photo path before the browser uploads
 * the actual file.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Normally the caller's own tour; with a valid on-behalf token
  // (« J'entre pour un collègue », badge + PIN already checked), the
  // colleague's — through the service-role client, so every query
  // below also pins organization_id explicitly.
  const actor = await resolveTourActor(req, appUser);
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const { db: supabase, driverId, helperId } = actor;
  const forColleague = helperId !== null;

  const { data: existingOpen } = await supabase
    .from("planning_entries")
    .select("id")
    .eq("organization_id", appUser.organization_id)
    .eq("driver_id", driverId)
    .eq("status", "in_progress")
    .maybeSingle();
  if (existingOpen) {
    return NextResponse.json(
      {
        error: forColleague
          ? "Ce collègue a déjà une tournée en cours — utilisez « Terminer sa tournée »."
          : "Vous avez déjà une tournée en cours — terminez-la avant d'en démarrer une nouvelle.",
      },
      { status: 409 },
    );
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, service_id, registration")
    .eq("organization_id", appUser.organization_id)
    .eq("id", parsed.data.vehicle_id)
    .single();
  if (vehicleError || !vehicle) {
    return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });
  }
  if (!vehicle.service_id && !parsed.data.service_id) {
    return NextResponse.json(
      { error: `${vehicle.registration} n'est rattaché à aucun service — contactez un gestionnaire.` },
      { status: 422 },
    );
  }

  let tourServiceId = vehicle.service_id;
  if (parsed.data.service_id) {
    const { data: qualified } = await supabase
      .from("user_services")
      .select("service_id")
      .eq("user_id", driverId)
      .eq("service_id", parsed.data.service_id)
      .maybeSingle();
    if (!qualified) {
      return NextResponse.json({ error: forColleague ? "Ce collègue n'est pas qualifié sur ce service." : "Vous n'êtes pas qualifié sur ce service." }, { status: 422 });
    }
    tourServiceId = parsed.data.service_id;
  }

  // Coherence check against the vehicle's own history — not just
  // "is this a sane number", applied here (not only in the form) so
  // it can't be bypassed by a client bug.
  const referenceKm = await getVehicleLastKnownKm(supabase, vehicle.id);
  const regressionCheck = checkOdometerNotRegressing(parsed.data.start_km, referenceKm, "le dernier kilométrage connu de ce véhicule");
  if (!regressionCheck.ok) {
    return NextResponse.json({ error: regressionCheck.message }, { status: 422 });
  }

  const tourNumber = parsed.data.tour_number?.trim() || generateTourNumber(vehicle.registration);
  const reportFields = parsed.data.report_fields;
  const startFields = {
    vehicle_id: vehicle.id,
    service_id: tourServiceId,
    start_at: new Date().toISOString(),
    status: "in_progress" as const,
    start_km: parsed.data.start_km,
    start_km_photo_path: parsed.data.start_km_photo_path,
    start_photo_path: parsed.data.sheet_photo_path ?? null,
    ...(parsed.data.start_sheet_path?.startsWith(`${appUser.organization_id}/`) ? { start_sheet_path: parsed.data.start_sheet_path } : {}),
    start_vehicle_ok: parsed.data.vehicle_ok,
    // Only written for a colleague-assisted start, so plain starts keep
    // working even before migration 20260101000095 reaches a database.
    ...(helperId ? { started_by: helperId } : {}),
    ...(reportFields
      ? {
          report_bl_number: reportFields.bl_number ?? null,
          report_stops_total: arretsLivraison(reportFields, null),
          ...(reportFields.pickups != null ? { report_pickups: reportFields.pickups } : {}),
          report_packages_count: reportFields.packages_count ?? null,
          report_priority_count: reportFields.priority_count ?? null,
          report_departure_time: reportFields.departure_time ?? null,
          report_ocr_raw: { start: reportFields },
        }
      : {}),
  };

  // If a manager already planned a tour for this driver, turn that
  // same row into the real one instead of creating a parallel record
  // — this is what keeps a last-minute vehicle swap or delay
  // reflected on the manager's planning rather than leaving a stale
  // "planned" entry sitting next to a disconnected "in_progress" one.
  // Prefer the explicit id round-tripped from plannedToday (reliable,
  // doesn't depend on the driver typing anything); fall back to a
  // tour-number text match for a driver who typed one without ever
  // being shown a plannedToday suggestion (e.g. an older client).
  const plannedMatch = parsed.data.planned_entry_id
    ? (
        await supabase
          .from("planning_entries")
          .select("id, vehicle_id")
          .eq("id", parsed.data.planned_entry_id)
          .eq("organization_id", appUser.organization_id)
          .eq("driver_id", driverId)
          .eq("status", "planned")
          .maybeSingle()
      ).data
    : parsed.data.tour_number
      ? (
          await supabase
            .from("planning_entries")
            .select("id, vehicle_id")
            .eq("organization_id", appUser.organization_id)
            .eq("driver_id", driverId)
            .eq("tour_number", parsed.data.tour_number)
            .eq("status", "planned")
            .maybeSingle()
        ).data
      : null;

  // Tournée fermée par l'encadrement (migration 20261105000001) : pas de démarrage.
  if (plannedMatch) {
    const fermee = await refusSiFermee(appUser.organization_id, plannedMatch.id);
    if (fermee) return NextResponse.json({ error: fermee }, { status: 423 });
  }

  // A changed vehicle is detected here, from the planned row's own
  // original vehicle_id — never from a client-supplied "I swapped"
  // flag, which a driver could just omit.
  const vehicleChanged = Boolean(plannedMatch?.vehicle_id && plannedMatch.vehicle_id !== vehicle.id);
  if (vehicleChanged && !parsed.data.change_reason) {
    return NextResponse.json(
      { error: "Un motif est requis : ce véhicule n'est pas celui prévu au planning." },
      { status: 422 },
    );
  }
  // Hors dépannage : photos d'état du véhicule récupéré obligatoires.
  if (vehicleChanged) {
    const manquantes = photosManquantes(parsed.data.change_type, parsed.data.change_photos);
    if (manquantes.length) {
      return NextResponse.json(
        { error: `Changement de véhicule : photos obligatoires manquantes (${manquantes.map(libellePhoto).join(", ")}).` },
        { status: 422 },
      );
    }
    if ((parsed.data.change_photos ?? []).some((p) => !p.path.startsWith(`${appUser.organization_id}/`))) {
      return NextResponse.json({ error: "Chemin de photo invalide." }, { status: 403 });
    }
  }

  const champsDepart = vehicleChanged ? { ...startFields, vehicle_change_type: parsed.data.change_type ?? "changement" } : startFields;
  const { data, error } = plannedMatch
    ? await supabase.from("planning_entries").update(champsDepart).eq("id", plannedMatch.id).select("id").single()
    : await supabase
        .from("planning_entries")
        .insert({ organization_id: appUser.organization_id, tour_number: tourNumber, driver_id: driverId, ...champsDepart })
        .select("id")
        .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (vehicleChanged && plannedMatch?.vehicle_id && parsed.data.change_reason) {
    await enregistrerPhotosChangement(supabase, {
      organizationId: appUser.organization_id,
      planningEntryId: data.id,
      vehicleId: vehicle.id,
      driverId,
      stage: "depart",
      photos: parsed.data.change_photos ?? [],
    });
    await reportVehicleSwap(supabase, {
      organizationId: appUser.organization_id,
      plannedEntryId: data.id,
      plannedVehicleId: plannedMatch.vehicle_id,
      actualVehicleId: vehicle.id,
      reason: parsed.data.change_type === "depannage" ? `dépannage — ${parsed.data.change_reason}` : parsed.data.change_reason,
    });
  }

  let problemPhotoStoragePath: string | null = null;
  if (!parsed.data.vehicle_ok) {
    problemPhotoStoragePath = `${appUser.organization_id}/${vehicle.id}/${randomUUID()}.jpg`;
    const { error: interventionError } = await supabase.from("vehicle_interventions").insert({
      organization_id: appUser.organization_id,
      vehicle_id: vehicle.id,
      type: "Signalement automatique (départ de tournée)",
      description: parsed.data.problem_description,
      urgency: "normal",
      requested_by: appUser.id,
      planning_entry_id: data.id,
      photo_path: problemPhotoStoragePath,
    });
    if (interventionError) return NextResponse.json({ error: interventionError.message }, { status: 500 });
  }

  return NextResponse.json({ tourId: data.id, tourNumber, problemPhotoStoragePath });
}
