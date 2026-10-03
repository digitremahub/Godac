import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

/**
 * Storage-path issuer for a vehicle odometer photo — taken at tour
 * start/end (app/api/tours) or when opening a maintenance request
 * (app/api/vehicle-interventions). Reuses the tour-photos bucket
 * (org-scoped by first path segment) rather than a fourth almost
 * identical one.
 */
export async function POST() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const ocrEnabled = await isModuleEnabled(supabase, appUser.organization_id, "ocr");
  if (!ocrEnabled) {
    return NextResponse.json({ error: "Module OCR non activé pour votre organisation" }, { status: 403 });
  }

  const storagePath = `${appUser.organization_id}/odometer/${randomUUID()}.jpg`;
  return NextResponse.json({ storagePath });
}
