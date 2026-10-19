import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/** Chemin de dépôt d'une photo d'état (changement de véhicule), bucket tour-photos. */
export async function POST() {
  const g = await garderApi({ modulesAuMoinsUn: ["planning", "route_optimizer"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  return NextResponse.json({ storagePath: `${appUser.organization_id}/changement-vehicule/${randomUUID()}.jpg` });
}
