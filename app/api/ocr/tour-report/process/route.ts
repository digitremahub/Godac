import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { extractTourReportFromImage } from "@/lib/ocr/tour-report";

const bodySchema = z.object({ storagePath: z.string().min(1) });

/** Reads a tour report photo already uploaded to tour-photos — see app/api/ocr/odometer/process, same shape. */
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
  const { data: fileBlob, error: downloadError } = await supabase.storage.from("tour-photos").download(parsed.data.storagePath);
  if (downloadError || !fileBlob) {
    return NextResponse.json({ error: `Téléchargement de la photo impossible: ${downloadError?.message}` }, { status: 500 });
  }

  // The photo stays attached; only the AI reading is skipped when the
  // organisation has the "ocr" module off.
  if (!(await isModuleEnabled(supabase, appUser.organization_id, "ocr"))) {
    return NextResponse.json({ fields: null, error: "Lecture automatique désactivée pour votre entreprise — complétez les champs à la main." });
  }

  const imageBytes = Buffer.from(await fileBlob.arrayBuffer());
  const result = await extractTourReportFromImage(imageBytes, parsed.data.storagePath);

  if (!result.ok) {
    return NextResponse.json({ fields: null, error: result.reason });
  }

  return NextResponse.json({ fields: result.fields });
}
