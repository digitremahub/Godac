import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/clerk/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { processFuelEntryOcr } from "@/lib/ocr/pipeline";

const bodySchema = z.object({
  fuelEntryId: z.string().uuid(),
  ticketPhotoPath: z.string().min(1),
});

/**
 * Step 4 of the OCR flow: called once the ticket photo has finished
 * uploading to Storage. Records the photo path, then runs the Mindee
 * extraction (lib/ocr/pipeline.ts).
 *
 * Runs inline in a Next.js Route Handler for the MVP. If extraction
 * volume outgrows Vercel's execution limits, move the
 * processFuelEntryOcr() call to the Railway worker
 * (RAILWAY_WORKER_URL) and have this route just enqueue the job —
 * the function signature does not need to change.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("fuel_entries")
    .update({ ticket_photo_path: parsed.data.ticketPhotoPath })
    .eq("id", parsed.data.fuelEntryId)
    .eq("organization_id", appUser.organization_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await processFuelEntryOcr(parsed.data.fuelEntryId);

  return NextResponse.json({ ok: true });
}
