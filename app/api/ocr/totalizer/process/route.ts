import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { extractTotalizerReading } from "@/lib/ocr/mindee";

const bodySchema = z.object({ storagePath: z.string().min(1) });

/**
 * Reads the digits off an already-uploaded totalizer photo. Stateless
 * w.r.t. fuel_entries by design (see the init route) — just returns
 * the reading (or null + a reason) for the client to pre-fill its
 * form field with, exactly like the ticket-OCR flow but without
 * needing a DB row to write the result onto yet.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!parsed.data.storagePath.startsWith(`${appUser.organization_id}/`)) {
    return NextResponse.json({ error: "Chemin de photo invalide." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET ?? "fuel-tickets")
    .download(parsed.data.storagePath);

  if (downloadError || !fileBlob) {
    return NextResponse.json({ error: `Téléchargement de la photo impossible: ${downloadError?.message}` }, { status: 500 });
  }

  const imageBytes = Buffer.from(await fileBlob.arrayBuffer());
  const result = await extractTotalizerReading(imageBytes, parsed.data.storagePath);

  if (!result.ok) {
    return NextResponse.json({ reading: null, confidence: null, error: result.reason });
  }

  return NextResponse.json({ reading: result.reading.value, confidence: result.reading.confidence });
}
