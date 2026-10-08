import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { extractFuelReceipt } from "@/lib/ocr/fuel-receipt";

/**
 * Runs the OCR extraction for one fuel_entries row and writes the
 * result back. Called from app/api/ocr/process/route.ts, itself
 * triggered right after the chauffeur uploads a ticket photo (a
 * Next.js API route today; swap the caller for a Railway webhook
 * without changing this function if the job needs to move off
 * Vercel's execution limits later).
 *
 * State machine enforced here: pending_ocr -> awaiting_validation
 * (success) or pending_ocr -> ocr_failed (any failure) — validated
 * is only ever reached by a human via the review UI, never by this
 * pipeline directly.
 */
export async function processFuelEntryOcr(fuelEntryId: string): Promise<void> {
  const supabase = createAdminSupabaseClient();

  const { data: entry, error: fetchError } = await supabase
    .from("fuel_entries")
    .select("id, organization_id, ticket_photo_path, status")
    .eq("id", fuelEntryId)
    .single();

  if (fetchError || !entry) {
    console.error("processFuelEntryOcr: entry not found", fuelEntryId, fetchError);
    return;
  }

  if (entry.status !== "pending_ocr") {
    // Already processed (webhook retry, double-submit) — no-op.
    return;
  }

  if (!entry.ticket_photo_path) {
    await markFailed(fuelEntryId, "Aucune photo de ticket associée à cet enregistrement.");
    return;
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET ?? "fuel-tickets")
    .download(entry.ticket_photo_path);

  if (downloadError || !fileBlob) {
    await markFailed(fuelEntryId, `Téléchargement de la photo impossible: ${downloadError?.message}`);
    return;
  }

  const imageBytes = Buffer.from(await fileBlob.arrayBuffer());
  const result = await extractFuelReceipt(imageBytes, entry.ticket_photo_path);

  if (!result.ok) {
    await markFailed(fuelEntryId, result.reason);
    return;
  }

  const { fields, raw } = result;

  const { error: updateError } = await supabase
    .from("fuel_entries")
    .update({
      status: "awaiting_validation",
      occurred_at: combineDateTime(fields.date, fields.time) ?? undefined,
      liters: fields.liters ?? undefined,
      unit_price: fields.unit_price ?? undefined,
      station_name: fields.station_name ?? undefined,
      ocr_raw: raw as any,
      ocr_error: null,
    })
    .eq("id", fuelEntryId);

  if (updateError) {
    console.error("processFuelEntryOcr: failed to persist extraction", updateError);
    await markFailed(fuelEntryId, `Échec d'enregistrement de l'extraction: ${updateError.message}`);
  }
}

async function markFailed(fuelEntryId: string, reason: string) {
  const supabase = createAdminSupabaseClient();
  await supabase
    .from("fuel_entries")
    .update({ status: "ocr_failed", ocr_error: reason })
    .eq("id", fuelEntryId);

  const { data: entry } = await supabase
    .from("fuel_entries")
    .select("organization_id, vehicle_id")
    .eq("id", fuelEntryId)
    .single();

  if (entry) {
    // Scopes the alert to the vehicle's own service (see
    // 20260101000078) instead of broadcasting it to every manager in
    // the organization.
    const { data: vehicle } = await supabase.from("vehicles").select("service_id").eq("id", entry.vehicle_id).single();

    await supabase.from("alerts").insert({
      organization_id: entry.organization_id,
      type: "ocr_failure",
      severity: "info",
      message: `Extraction OCR échouée pour un ticket : ${reason}. Bascule en saisie manuelle.`,
      related_table: "fuel_entries",
      related_id: fuelEntryId,
      recipient_roles: ["manager", "manager_chauffeur"],
      service_id: vehicle?.service_id ?? null,
    });
  }
}

function combineDateTime(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const iso = time ? `${date}T${time}` : `${date}T00:00:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
