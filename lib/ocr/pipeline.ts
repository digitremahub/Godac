import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { extractFuelReceipt } from "@/lib/ocr/mindee";

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

  const { extraction, raw } = result;

  const { error: updateError } = await supabase
    .from("fuel_entries")
    .update({
      status: "awaiting_validation",
      occurred_at: combineDateTime(extraction.date.value, extraction.time.value) ?? undefined,
      liters: extraction.liters.value ?? undefined,
      unit_price: extraction.unitPrice.value ?? undefined,
      station_name: extraction.stationName.value ?? undefined,
      ocr_raw: raw as any,
      ocr_confidence: {
        date: extraction.date.confidence,
        time: extraction.time.confidence,
        liters: extraction.liters.confidence,
        unitPrice: extraction.unitPrice.confidence,
        totalAmount: extraction.totalAmount.confidence,
        stationName: extraction.stationName.confidence,
        fuelType: extraction.fuelType.confidence,
      },
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
    .select("organization_id")
    .eq("id", fuelEntryId)
    .single();

  if (entry) {
    await supabase.from("alerts").insert({
      organization_id: entry.organization_id,
      type: "ocr_failure",
      severity: "info",
      message: `Extraction OCR échouée pour un ticket : ${reason}. Bascule en saisie manuelle.`,
      related_table: "fuel_entries",
      related_id: fuelEntryId,
      recipient_roles: ["manager", "manager_chauffeur"],
    });
  }
}

function combineDateTime(date: string | null, time: string | null): string | null {
  if (!date) return null;
  const iso = time ? `${date}T${time}` : `${date}T00:00:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
