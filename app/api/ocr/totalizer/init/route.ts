import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

/**
 * Storage-path issuer for a totalizer counter photo (before/after a
 * fill-up). Reuses the fuel-tickets bucket — its org-scoped RLS only
 * checks the first path segment — but isn't tied to a fuel_entries
 * row: that row may not exist yet (the counter can be photographed
 * before the manual-entry form is even submitted). The path gets
 * attached to whichever row is eventually created/updated (see
 * app/api/fuel-entries).
 */
export async function POST() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const ocrEnabled = await isModuleEnabled(supabase, appUser.organization_id, "ocr");
  if (!ocrEnabled) {
    return NextResponse.json({ error: "Module OCR non activé pour votre organisation" }, { status: 403 });
  }

  const storagePath = `${appUser.organization_id}/totalizer/${randomUUID()}.jpg`;
  return NextResponse.json({ storagePath });
}
