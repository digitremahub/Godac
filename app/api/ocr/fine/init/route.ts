import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAppUser } from "@/lib/auth/session";

/** Storage-path issuer for a fine notice photo — see app/api/ocr/fine/process. */
export async function POST() {
  const appUser = await requireAppUser();
  const storagePath = `${appUser.organization_id}/${randomUUID()}.jpg`;
  return NextResponse.json({ storagePath });
}
