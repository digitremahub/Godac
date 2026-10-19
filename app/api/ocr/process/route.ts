import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { processFuelEntryOcr } from "@/lib/ocr/pipeline";
import type { TicketExtras } from "@/lib/ocr/ticket-check";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z.object({
  fuelEntryId: z.string().uuid(),
  ticketPhotoPath: z.string().min(1),
});

/**
 * Step 4 of the OCR flow: called once the ticket photo has finished
 * uploading to Storage. Records the photo path, then runs the Claude
 * vision extraction (lib/ocr/pipeline.ts). Returns the ticket's total
 * and fuel type for the driver's check step (`ticket`, null if the
 * extraction failed).
 *
 * Runs inline in a Next.js Route Handler for the MVP. If extraction
 * volume outgrows Vercel's execution limits, move the
 * processFuelEntryOcr() call to the Railway worker
 * (RAILWAY_WORKER_URL) and have this route just enqueue the job —
 * the function signature does not need to change.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("fuel_entries")
    .update({ ticket_photo_path: parsed.data.ticketPhotoPath })
    .eq("id", parsed.data.fuelEntryId)
    .eq("organization_id", appUser.organization_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let ticket: TicketExtras | null = null;
  if (await isModuleEnabled(supabase, appUser.organization_id, "ocr")) {
    ticket = await processFuelEntryOcr(parsed.data.fuelEntryId, appUser.id);
  }

  return NextResponse.json({ ok: true, ticket });
}
