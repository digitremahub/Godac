import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  tank_id: z.string().uuid(),
  totalizer_reading: z.coerce.number().min(0).optional(),
  note: z.string().optional(),
});

/**
 * Creates the tank_photos row up front with its final storage path —
 * unlike app/api/ocr/init/route.ts, there's no second "process" step
 * afterwards (no OCR is attempted), and the submitter isn't allowed
 * to update this row once created (review/correction is
 * manager-like/direction only, see the RLS policy), so the path can't
 * be patched in after the fact. The browser uploads straight to
 * Storage at the returned path once this returns.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const storagePath = `${appUser.organization_id}/${parsed.data.tank_id}/${randomUUID()}.jpg`;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tank_photos")
    .insert({
      organization_id: appUser.organization_id,
      tank_id: parsed.data.tank_id,
      submitted_by: appUser.id,
      totalizer_reading: parsed.data.totalizer_reading,
      note: parsed.data.note || null,
      photo_path: storagePath,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tankPhotoId: data.id, storagePath });
}
