import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  washed_exterior: z.boolean(),
  washed_cabin_interior: z.boolean(),
  washed_trailer: z.boolean(),
  has_photo: z.boolean().default(false),
});

/**
 * Logs a wash — any org member, naming themselves as the driver (see
 * migration 20260101000037). Photo path is pre-registered the same
 * way tours/open does it, in the shared tour-photos bucket: the row
 * is created with its final path before the browser uploads the file.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["washes"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { vehicle_id, washed_exterior, washed_cabin_interior, washed_trailer, has_photo } = parsed.data;

  if (!washed_exterior && !washed_cabin_interior && !washed_trailer) {
    return NextResponse.json({ error: "Cochez au moins une case." }, { status: 422 });
  }

  const supabase = await createServerSupabaseClient();
  const storagePath = has_photo ? `${appUser.organization_id}/${vehicle_id}/${randomUUID()}.jpg` : null;

  const { data, error } = await supabase
    .from("vehicle_washes")
    .insert({
      organization_id: appUser.organization_id,
      vehicle_id,
      driver_id: appUser.id,
      washed_exterior,
      washed_cabin_interior,
      washed_trailer,
      photo_path: storagePath,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id, storagePath });
}
