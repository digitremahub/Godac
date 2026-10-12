import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { extractFineFromImage } from "@/lib/ocr/fine";

const bodySchema = z.object({ storagePath: z.string().min(1) });

/** Reads a fine-notice photo already uploaded to fine-photos — same shape as app/api/ocr/tour-report/process. */
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
  const { data: fileBlob, error: downloadError } = await supabase.storage.from("fine-photos").download(parsed.data.storagePath);
  if (downloadError || !fileBlob) {
    return NextResponse.json({ error: `Téléchargement de la photo impossible: ${downloadError?.message}` }, { status: 500 });
  }

  // The photo stays attached; only the AI reading is skipped when the
  // organisation has the "ocr" module off.
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "ocr"))) {
    return NextResponse.json({ fields: null, error: "Lecture automatique désactivée pour votre entreprise — complétez les champs à la main." });
  }

  const imageBytes = Buffer.from(await fileBlob.arrayBuffer());
  const result = await extractFineFromImage(imageBytes, parsed.data.storagePath);

  if (!result.ok) {
    return NextResponse.json({ fields: null, error: result.reason });
  }

  // Resolve the OCR'd plate against this org's own fleet — never
  // trusted as a direct vehicle_id, just a hint the form prefills and
  // the user can still correct.
  let vehicleId: string | null = null;
  if (result.fields.registration) {
    const normalized = result.fields.registration.replace(/[\s-]/g, "").toUpperCase();
    const { data: vehicles } = await supabase.from("vehicles").select("id, registration");
    const match = (vehicles ?? []).find((v) => v.registration.replace(/[\s-]/g, "").toUpperCase() === normalized);
    vehicleId = match?.id ?? null;
  }

  return NextResponse.json({ fields: result.fields, vehicleId });
}
