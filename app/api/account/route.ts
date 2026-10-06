import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";

const bodySchema = z.object({
  full_name: z.string().min(1),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  contact_email: z.string().email().nullable().optional(),
});

/**
 * Self-service profile edit — unlike app/api/admin/users/[id], which
 * only direction can call (and for any user), this only ever touches
 * the signed-in user's own row, so no role gate is needed beyond
 * being authenticated. RLS ("users: self update") is the real backstop.
 *
 * address is geocoded server-side (never trusting client-supplied
 * coordinates) — see lib/geo/geocode.ts. A failed/ambiguous geocode
 * still saves the address text (so it round-trips in the form) but
 * clears the coordinates, which is exactly what
 * estimateReturnDistanceDeltaKm treats as "not enough data".
 */
export async function PATCH(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let addressFields: Record<string, string | number | null> = {};
  if (parsed.data.address !== undefined) {
    const geocoded = parsed.data.address ? await geocodeAddress(parsed.data.address) : null;
    addressFields = {
      address: parsed.data.address,
      address_lat: geocoded?.lat ?? null,
      address_lng: geocoded?.lng ?? null,
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("users")
    .update({
      full_name: parsed.data.full_name,
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.contact_email !== undefined ? { contact_email: parsed.data.contact_email } : {}),
      ...addressFields,
    })
    .eq("id", appUser.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
