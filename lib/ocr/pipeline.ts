import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { extractFuelReceipt } from "@/lib/ocr/fuel-receipt";
import { classifyTicketFuel, type TicketExtras } from "@/lib/ocr/ticket-check";
import { parisLocalToIso } from "@/lib/utils/paris-time";

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
 *
 * Returns what the ticket says beyond the row's own columns (total
 * payé, type de carburant) so the review step can check it — also kept
 * in ocr_raw.fields for the manager review queue. null on failure.
 */
export async function processFuelEntryOcr(fuelEntryId: string): Promise<TicketExtras | null> {
  const supabase = createAdminSupabaseClient();

  const { data: entry, error: fetchError } = await supabase
    .from("fuel_entries")
    .select("id, organization_id, ticket_photo_path, status, tank_id")
    .eq("id", fuelEntryId)
    .single();

  if (fetchError || !entry) {
    console.error("processFuelEntryOcr: entry not found", fuelEntryId, fetchError);
    return null;
  }

  if (entry.status !== "pending_ocr") {
    // Already processed (webhook retry, double-submit) — no-op.
    return null;
  }

  if (!entry.ticket_photo_path) {
    await markFailed(fuelEntryId, "Aucune photo de ticket associée à cet enregistrement.");
    return null;
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET ?? "fuel-tickets")
    .download(entry.ticket_photo_path);

  if (downloadError || !fileBlob) {
    await markFailed(fuelEntryId, `Téléchargement de la photo impossible: ${downloadError?.message}`);
    return null;
  }

  const imageBytes = Buffer.from(await fileBlob.arrayBuffer());
  const result = await extractFuelReceipt(imageBytes, entry.ticket_photo_path);

  if (!result.ok) {
    await markFailed(fuelEntryId, result.reason);
    return null;
  }

  const { fields, raw } = result;
  // Achat en station : le produit vient du ticket (AdBlue n'est pas du
  // gazole). À la cuve, la base impose celui de la cuve.
  const product = !entry.tank_id && classifyTicketFuel(fields.fuel_type) === "adblue" ? "adblue" : undefined;

  const { error: updateError } = await supabase
    .from("fuel_entries")
    .update({
      status: "awaiting_validation",
      // Heure murale imprimée sur le ticket, donc heure de Paris — pas
      // l'UTC du serveur.
      occurred_at: fields.date ? (parisLocalToIso(fields.date, fields.time) ?? undefined) : undefined,
      liters: fields.liters ?? undefined,
      unit_price: fields.unit_price ?? undefined,
      station_name: fields.station_name ?? undefined,
      product,
      ocr_raw: { ...(raw as object), fields } as any,
      ocr_error: null,
    })
    .eq("id", fuelEntryId);

  if (updateError) {
    console.error("processFuelEntryOcr: failed to persist extraction", updateError);
    await markFailed(fuelEntryId, `Échec d'enregistrement de l'extraction: ${updateError.message}`);
    return null;
  }

  return { total_amount: fields.total_amount, fuel_type: fields.fuel_type };
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
