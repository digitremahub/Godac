import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/** Storage-path issuer for a fine notice photo — see app/api/ocr/fine/process. */
export async function POST() {
  const g = await garderApi({ roles: ["direction", "manager"], modules: ["fines"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const storagePath = `${appUser.organization_id}/${randomUUID()}.jpg`;
  return NextResponse.json({ storagePath });
}
