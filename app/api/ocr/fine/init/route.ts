import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

/** Chemin de dépôt de l'avis (photo ou PDF) — voir app/api/ocr/fine/process. */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "manager"], modules: ["fines"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const corps = (await req.json().catch(() => ({}))) as { ext?: string };
  const ext = ["jpg", "png", "webp", "pdf"].includes(corps.ext ?? "") ? corps.ext : "jpg";
  const storagePath = `${appUser.organization_id}/${randomUUID()}.${ext}`;
  return NextResponse.json({ storagePath });
}
