import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAppUser } from "@/lib/auth/session";

/**
 * Storage-path issuer for a tour report photo (handheld stats screen
 * at departure, printed compte-rendu at return — see
 * app/api/ocr/tour-report/process). Reuses the tour-photos bucket,
 * same convention as app/api/ocr/odometer/init.
 */
export async function POST() {
  const appUser = await requireAppUser();
  const storagePath = `${appUser.organization_id}/tour-report/${randomUUID()}.jpg`;
  return NextResponse.json({ storagePath });
}
