import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { VehicleDocument } from "@/lib/vehicles/document-types";

export { VEHICLE_DOC_TYPES, expiryStatus } from "@/lib/vehicles/document-types";
export type { VehicleDocument } from "@/lib/vehicles/document-types";

const SIGNED_URL_TTL_S = 10 * 60;

/**
 * The vehicle's documents the caller may see — row visibility is
 * decided by RLS on the caller's own client (manager-like/comptable:
 * all, others: driver_visible only, see migration 20260101000097);
 * only then are signed URLs minted, with the service role, for exactly
 * those files.
 */
export async function listVehicleDocuments(supabase: SupabaseClient, vehicleId: string): Promise<VehicleDocument[]> {
  const { data } = await supabase
    .from("vehicle_documents")
    .select("id, doc_type, file_path, expires_on, driver_visible, uploaded_at")
    .eq("vehicle_id", vehicleId)
    .order("doc_type");
  const rows = (data ?? []) as {
    id: string;
    doc_type: string;
    file_path: string;
    expires_on: string | null;
    driver_visible: boolean;
    uploaded_at: string;
  }[];
  if (rows.length === 0) return [];

  const admin = createAdminSupabaseClient();
  const { data: signed } = await admin.storage.from("vehicle-documents").createSignedUrls(
    rows.map((r) => r.file_path),
    SIGNED_URL_TTL_S,
  );
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return rows.map((r) => ({
    id: r.id,
    docType: r.doc_type,
    expiresOn: r.expires_on,
    driverVisible: r.driver_visible,
    uploadedAt: r.uploaded_at,
    url: urlByPath.get(r.file_path) ?? null,
  }));
}

