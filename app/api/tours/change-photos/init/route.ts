import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAppUser } from "@/lib/auth/session";

/** Chemin de dépôt d'une photo d'état (changement de véhicule), bucket tour-photos. */
export async function POST() {
  const appUser = await requireAppUser();
  return NextResponse.json({ storagePath: `${appUser.organization_id}/changement-vehicule/${randomUUID()}.jpg` });
}
