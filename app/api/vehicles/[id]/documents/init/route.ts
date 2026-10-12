import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
const bodySchema = z.object({ contentType: z.string() });

/** Hands the browser the storage path to upload to (vehicle-documents bucket) — confirmed afterwards by POST ../documents. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Réservé à l'exploitation." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  const ext = parsed.success ? EXT[parsed.data.contentType] : undefined;
  if (!ext) return NextResponse.json({ error: "Format accepté : PDF, JPG, PNG, WEBP ou HEIC." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: vehicle } = await supabase.from("vehicles").select("id").eq("id", id).maybeSingle();
  if (!vehicle) return NextResponse.json({ error: "Véhicule introuvable." }, { status: 404 });

  return NextResponse.json({ storagePath: `${appUser.organization_id}/${id}/${randomUUID()}.${ext}` });
}
